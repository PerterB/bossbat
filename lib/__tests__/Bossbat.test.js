'use strict';

/* eslint-env jest */
/* eslint-disable global-require */

describe('Bossbat Units', function () {
  var Bossbat = void 0;
  var Redis = void 0;

  beforeAll(function () {
    jest.mock('ioredis');
    Bossbat = require('../Bossbat');
    Redis = require('ioredis');
  });

  afterAll(function () {
    jest.resetModules();
    jest.unmock('ioredis');
  });

  afterEach(function () {
    jest.resetAllMocks();
  });

  it('constructs with no arguments', function () {
    var boss = new Bossbat();
    expect(boss).toBeInstanceOf(Bossbat);
    expect(Redis.mock.instances.length).toEqual(2);
    expect(Redis.mock.instances[1].config.mock.calls.length).toEqual(1);
    boss.quit();
  });

  it('constructs with arguments', function () {
    var boss = new Bossbat({ connection: { db: 4 }, ttl: 101, prefix: 'p', tz: 'Europe/Helsinki', disableRedisConfig: true });
    expect(boss).toBeInstanceOf(Bossbat);
    expect(boss.ttl).toEqual(101);
    expect(boss.prefix).toEqual('p');
    expect(boss.tz).toEqual('Europe/Helsinki');
    expect(Redis.mock.instances.length).toEqual(2);
    expect(Redis.mock.instances[1].config.mock.calls.length).toEqual(0);
    boss.quit();
  });

  it('pushes to the qas array when calling qa', function () {
    var boss = new Bossbat();
    var fn1 = function fn1() {};
    var fn2 = function fn2() {};
    boss.qa(fn1);
    boss.qa(fn2);
    expect(boss.qas).toEqual([fn1, fn2]);
    boss.quit();
  });
});

describe('Bossbat Integration', function () {
  var Bossbat = void 0;
  var Redis = void 0;
  var boss = void 0;
  var bossAlternative = void 0;

  beforeAll(function () {
    jest.resetModules();
    jest.unmock('ioredis');
    Bossbat = require('../Bossbat');
    Redis = require('ioredis');
  });

  beforeEach(function () {
    boss = new Bossbat({
      connection: { db: 3 }
    });
    bossAlternative = new Bossbat({
      connection: { db: 3 }
    });
  });

  afterEach(function () {
    return (
      // Put this on a slight delay so that the locks can be released before the test ends:
      new Promise(function (resolve) {
        return setTimeout(resolve, 0);
      }).then(function () {
        return Promise.all([boss.quit(), bossAlternative.quit()]);
      })
    );
  });

  it('runs scheduled work', function (done) {
    boss.hire('scheduled', {
      every: '200 ms',
      work: function () {
        function work(jobName) {
          expect(jobName).toEqual('scheduled');
          done();
        }

        return work;
      }()
    });
  });

  it('runs QA tasks before running scheduled work', function (done) {
    var flags = { performed: false, qa: false };

    boss.qa(function (name, def, next) {
      expect(flags).toEqual({ performed: false, qa: false });
      flags.qa = true;
      next().then(function () {
        expect(flags).toEqual({ performed: true, qa: true });
        done();
      });
    });

    boss.hire('qas', {
      every: '200 ms',
      work: function () {
        function work() {
          expect(flags).toEqual({ performed: false, qa: true });
          flags.performed = true;
        }

        return work;
      }()
    });
  });

  it('only runs one unit of work in the scheduled time', function (done) {
    var performed = 0;

    // Start 50 of these jobs, which still should only be fired once:
    Array(50).fill().forEach(function () {
      boss.hire('one', {
        every: '200 ms',
        work: function () {
          function work() {
            performed += 1;
            expect(performed).toEqual(1);
            done();
          }

          return work;
        }()
      });
    });
  });

  it('only performs on one worker, even when given multiple workers', function (done) {
    var performed = 0;

    // Start 50 of these jobs, which still should only be fired once:
    Array(50).fill().forEach(function () {
      [boss, bossAlternative].forEach(function (b) {
        b.hire('one', {
          every: '200 ms',
          work: function () {
            function work() {
              performed += 1;
              expect(performed).toEqual(1);
              done();
            }

            return work;
          }()
        });
      });
    });
  });

  it('removes tasks with fire', function (done) {
    boss.hire('fired', {
      every: '200 ms',
      work: function () {
        function work() {
          done(new Error('Work should not be called'));
        }

        return work;
      }()
    });

    boss.fire('fired');

    setTimeout(done, 1000);
  });

  it('does not require every to be passed', function (done) {
    boss.hire('demanded', {
      work: function () {
        function work() {
          done();
        }

        return work;
      }()
    });

    boss.demand('demanded');
  });

  it('ignores non-work expiring messages', function (done) {
    var redis = new Redis({ db: 3 });
    redis.set('some-other-key', 'val', 'PX', 1);
    redis.quit();

    setTimeout(done, 100);
  });

  it('can demand over a scheduled key', function (done) {
    var performed = 0;

    boss.hire('both', {
      every: '200 ms',
      work: function () {
        function work() {
          performed += 1;
          if (performed === 2) done();
        }

        return work;
      }()
    });

    boss.demand('both');
  });

  it('allows colons in names', function (done) {
    boss.hire('something:with:colons', {
      every: '200 ms',
      work: function () {
        function work() {
          done();
        }

        return work;
      }()
    });
  });

  it('allows cron formats', function (done) {
    boss.hire('cronjob', {
      cron: '*/1 * * * * *',
      work: function () {
        function work() {
          done();
        }

        return work;
      }()
    });
  });

  it('allows numeric values for every', function (done) {
    boss.hire('numeric', {
      every: 200,
      work: function () {
        function work() {
          done();
        }

        return work;
      }()
    });
  });

  it('throws when given an invalid type for every', function () {
    expect(function () {
      boss.hire('throws', {
        every: {}
      });
    }).toThrowError();
  });
});