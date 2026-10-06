'use strict';

const { EventEmitter } = require('node:events');
const CoreNotifying = require('nooblyjs-core/src/notifying/providers/notifying');
const ActivityRepo = require('../../src/data/models/activityRepo');
const { NotificationService, TOPICS } = require('../../src/services/modules/notificationService');
const { fakeCache, fakeLogger, memoryDataService } = require('../helpers/fakes');

describe('NotificationService', () => {
  let service;
  let activity;
  let logger;

  beforeEach(async () => {
    logger = fakeLogger();
    activity = new ActivityRepo({ dependencies: { dataservice: memoryDataService(), logging: logger } });
    await activity.init();
    service = new NotificationService({
      notifying: new CoreNotifying({}, new EventEmitter()),
      activity,
      cache: fakeCache(),
      logger
    });
    await service.init();
  });

  it('records ingest notifications for the owner and counts them as unread', async () => {
    await service.publish(TOPICS.documentIngested, { docId: 'd1', title: 'Doc', ownerEmail: 'a@x.io' });
    await service.publish(TOPICS.documentFailed, { docId: 'd2', title: 'Bad', ownerEmail: 'a@x.io', error: 'Nope.' });
    await service.idle();

    const entries = await activity.list({ user: 'a@x.io' });
    expect(entries.map((e) => e.message)).toEqual(expect.arrayContaining([
      '"Doc" is ready',
      '"Bad" could not be processed: Nope.'
    ]));
    expect(entries.every((e) => e.recipient === 'a@x.io')).toBe(true);
    expect(await service.getUnread('a@x.io')).toBe(2);
    expect(await service.getUnread('b@x.io')).toBe(0);

    await service.markRead('a@x.io');
    expect(await service.getUnread('a@x.io')).toBe(0);
  });

  it('records system alerts', async () => {
    await service.publish(TOPICS.systemAlert, { message: 'Queue stalled' });
    await service.idle();
    expect((await activity.list())[0]).toMatchObject({ type: TOPICS.systemAlert, message: 'Queue stalled' });
  });

  it('contains subscriber errors instead of letting them escape', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    jest.spyOn(activity, 'record').mockRejectedValue(new Error('storage down'));
    try {
      await service.publish(TOPICS.documentIngested, { docId: 'd1', title: 'Doc', ownerEmail: 'a@x.io' });
      await service.idle();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      expect(logger.calls).toContainEqual(expect.objectContaining({ level: 'error', message: '[NotificationService] Subscriber failed' }));
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
