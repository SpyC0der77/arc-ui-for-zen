'use strict';
// Version helpers for unit tests, built by the same code the browser uses.
const versions = require('../installer/versions.cjs');
const ZenniaZenData = require('../payload/content/shared/zen-data.js');

function zenFor(version = '1.24b', overlay = {}, host = {}) {
  const data = ZenniaZenData.merge(versions.resolve(version), overlay);
  ZenniaZenData.validate(data);
  return ZenniaZenData.create(data, {
    importModule: () => { throw new Error('No browser modules in unit tests'); },
    readText: () => { throw new Error('No chrome files in unit tests'); },
    ...host,
  });
}
module.exports = { zenFor };
