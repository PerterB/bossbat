'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _redlock = require('redlock');

var _redlock2 = _interopRequireDefault(_redlock);

var _ioredis = require('ioredis');

var _ioredis2 = _interopRequireDefault(_ioredis);

var _timestring = require('timestring');

var _timestring2 = _interopRequireDefault(_timestring);

var _throwback = require('throwback');

var _cronParser = require('cron-parser');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// We timeout jobs after 2 seconds:
var JOB_TTL = 2000;
var JOB_PREFIX = 'bossbat';

var Bossbat = function () {
  function Bossbat() {
    var _this = this;

    var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
        connection = _ref.connection,
        _ref$prefix = _ref.prefix,
        prefix = _ref$prefix === undefined ? JOB_PREFIX : _ref$prefix,
        _ref$ttl = _ref.ttl,
        ttl = _ref$ttl === undefined ? JOB_TTL : _ref$ttl,
        tz = _ref.tz,
        disableRedisConfig = _ref.disableRedisConfig;

    _classCallCheck(this, Bossbat);

    var DB_NUMBER = connection && connection.db || 0;

    this.prefix = prefix;
    this.ttl = ttl;
    this.tz = tz;

    this.client = new _ioredis2['default'](connection);
    this.subscriber = new _ioredis2['default'](connection);
    this.redlock = new _redlock2['default']([this.client], { retryCount: 0 });

    this.jobs = {};
    this.qas = [];

    if (!disableRedisConfig) {
      this.subscriber.config('SET', 'notify-keyspace-events', 'Ex');
    }

    // Subscribe to expiring keys on the jobs DB:
    this.subscriber.subscribe('__keyevent@' + String(DB_NUMBER) + '__:expired');
    this.subscriber.on('message', function (channel, message) {
      // Check to make sure that the message is a job run request:
      if (!message.startsWith(String(_this.prefix) + ':work:')) return;

      var jobName = message.startsWith(String(_this.prefix) + ':work:demand:') ? message.replace(String(_this.prefix) + ':work:demand:', '') : message.replace(String(_this.prefix) + ':work:', '');

      if (_this.jobs[jobName]) {
        // Attempt to perform the job. Only one worker will end up getting assigned
        // the job thanks to distributed locking via redlock.
        _this.doWork(jobName);
        // Schedule the next run. We do this in every instance because it's
        // just a simple set command, and is okay to run on top of eachother.
        if (_this.jobs[jobName].every || _this.jobs[jobName].cron) {
          _this.scheduleRun(jobName, _this.jobs[jobName]);
        }
      }
    });
  }

  _createClass(Bossbat, [{
    key: 'quit',
    value: function () {
      function quit() {
        this.jobs = {};
        return Promise.all([this.subscriber.quit(), this.client.quit()]);
      }

      return quit;
    }()
  }, {
    key: 'hire',
    value: function () {
      function hire(name, definition) {
        this.jobs[name] = definition;
        if (definition.every || definition.cron) {
          this.scheduleRun(name, definition);
        }
      }

      return hire;
    }()
  }, {
    key: 'fire',
    value: function () {
      function fire(name) {
        return this.client.del(this.getJobKey(name));
      }

      return fire;
    }()
  }, {
    key: 'qa',
    value: function () {
      function qa(fn) {
        this.qas.push(fn);
      }

      return qa;
    }()
  }, {
    key: 'demand',
    value: function () {
      function demand(name) {
        this.scheduleRun(name);
      }

      return demand;
    }()

    // Semi-privates:

  }, {
    key: 'getJobKey',
    value: function () {
      function getJobKey(name) {
        return String(this.prefix) + ':work:' + String(name);
      }

      return getJobKey;
    }()
  }, {
    key: 'getDemandKey',
    value: function () {
      function getDemandKey(name) {
        return String(this.prefix) + ':work:demand:' + String(name);
      }

      return getDemandKey;
    }()
  }, {
    key: 'getLockKey',
    value: function () {
      function getLockKey(name) {
        return String(this.prefix) + ':lock:' + String(name);
      }

      return getLockKey;
    }()
  }, {
    key: 'doWork',
    value: function () {
      function doWork(name) {
        var _this2 = this;

        this.redlock.lock(this.getLockKey(name), this.ttl).then(function (lock) {
          var fn = (0, _throwback.compose)(_this2.qas);
          // Call the QA functions, then finally the job function. We use a copy of
          // the job definition to prevent pollution between scheduled runs.
          var response = fn(name, Object.assign({}, _this2.jobs[name]), function (_, definition) {
            return definition.work(name);
          });

          var end = function () {
            function end() {
              lock.unlock();
            }

            return end;
          }();

          response.then(end, end);
        }, function () {
          return (
            // If we fail to get a lock, that means another instance already processed the job.
            // We just ignore these cases:
            null
          );
        });
      }

      return doWork;
    }()
  }, {
    key: 'scheduleRun',
    value: function () {
      function scheduleRun(name, definition) {
        // If there's no definition passed, it's a demand, let's schedule as tight as we can:
        if (!definition) {
          return this.client.set(this.getDemandKey(name), name, 'PX', 1, 'NX');
        }

        var timeout = void 0;
        if (definition.every) {
          var typeOfEvery = _typeof(definition.every);
          if (typeOfEvery === 'string') {
            // Passed a human interval:
            timeout = (0, _timestring2['default'])(definition.every, 'ms');
          } else if (typeOfEvery === 'number') {
            // Passed a ms interval:
            timeout = definition.every;
          } else {
            throw new Error('Unknown interval of type "' + String(typeOfEvery) + '" passed to hire.');
          }
        } else if (definition.cron) {
          var options = { iterator: false, tz: this.tz };
          var iterator = (0, _cronParser.parseExpression)(definition.cron, options);
          var nextCronTimeout = function () {
            function nextCronTimeout() {
              return iterator.next().getTime() - Date.now();
            }

            return nextCronTimeout;
          }();
          var cronTimeout = nextCronTimeout();
          timeout = cronTimeout > 0 ? cronTimeout : nextCronTimeout();
        }
        return this.client.set(this.getJobKey(name), name, 'PX', timeout, 'NX');
      }

      return scheduleRun;
    }()
  }]);

  return Bossbat;
}();

exports['default'] = Bossbat;
module.exports = exports['default'];