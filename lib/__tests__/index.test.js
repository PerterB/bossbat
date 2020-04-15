'use strict';

var _index = require('../index');

var _index2 = _interopRequireDefault(_index);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var BossbatCJS = require('../index'); /* eslint-env jest */

describe('index', function () {
  it('exports for commonJS and ES modules', function () {
    expect(_index2['default']).toEqual(BossbatCJS);
  });
});