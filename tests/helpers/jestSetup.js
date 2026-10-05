/**
 * @fileoverview Runs before each test file (jest setupFiles).
 *
 * The core reads BCRYPT_COST when its auth module loads; the production cost
 * (12) makes every createUser/login take ~250 ms, which pushed suites that
 * boot the app and sign in several users past Jest's hook timeout.
 */

'use strict';

process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';
