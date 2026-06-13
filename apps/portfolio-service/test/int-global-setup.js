'use strict';
const { resolve } = require('node:path');
const dotenv = require('dotenv');

module.exports = async function globalSetup() {
  dotenv.config({ path: resolve(__dirname, '../.env.test') });
};
