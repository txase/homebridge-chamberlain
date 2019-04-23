const _ = require('underscore');
const fetch = require('node-fetch');
const url = require('url');

const MyQApplicationId =
  'NWknvuBd7LoFHfXmKNMBcgajXtZEgKUh4V7WNzMidrpUUluDpVYVZx+xT4PCM5Kx';
const protocol = 'https:';
const host = 'myqexternal.myqdevice.com';

const GATEWAY_TYPE_IDS = [1, 15];

const req = ({body, headers, method, pathname, query}) =>
  fetch(url.format({host, pathname, protocol, query}), {
    body: body == null ? body : JSON.stringify(body),
    headers: _.extend({
      'Content-Type': 'application/json',
      'User-Agent': 'Chamberlain/3.61.1 (iPhone; iOS 10.0.1; Scale/2.00)',
      ApiVersion: '4.1',
      BrandId: '2',
      Culture: 'en',
      MyQApplicationId
    }, headers),
    method
  }).then(res => res.json()).then(data => {
    const {ReturnCode: code, ErrorMessage: message} = data;
    if (code !== '0') throw new Error(message || `Unknown Error (${code})`);

    return data;
  });

module.exports = class {
  constructor(options = {}) {
    this.options = options;
  }

  getSecurityToken(options = {}) {
    options = _.extend({}, this.options, options);
    const {password, SecurityToken, username} = options;
    if (SecurityToken) return Promise.resolve(SecurityToken);

    return req({
      method: 'POST',
      pathname: '/api/v4/User/Validate',
      body: {password, username}
    }).then(({SecurityToken}) => {
      this.options = _.extend({}, this.options, {SecurityToken});
      return SecurityToken;
    });
  }

  getDeviceList(options = {}) {
    return this.getSecurityToken(options).then(SecurityToken =>
      req({
        method: 'GET',
        pathname: '/api/v4/UserDeviceDetails/Get',
        headers: {SecurityToken},
        query: {filterOn: 'true'}
      })
    ).then(({Devices}) => Devices);
  }

  findDeviceId(devices) {
    const withoutGateways = devices.filter(device => !GATEWAY_TYPE_IDS.includes(device.MyQDeviceTypeId));
    const ids = withoutGateways.map(device => device.MyQDeviceId)
    const {0: MyQDeviceId, length} = ids;
    if (length === 0) throw new Error('No controllable devices found');

    if (length === 1) {
      this.options = _.extend({}, this.options, {MyQDeviceId});
      return MyQDeviceId;
    }

    throw new Error(`Multiple controllable devices found: ${ids.join(', ')}`);
  }

  getDeviceId(options = {}) {
    options = _.extend({}, this.options, options);
    const {MyQDeviceId} = options;
    if (MyQDeviceId) return Promise.resolve(MyQDeviceId);

    return this.getDeviceList(options).then(devices => findDeviceId(devices));
  }

  maybeRetry(fn) {
    return fn().catch(er => {
      if (er.message.indexOf('Please login again') === -1) throw er;

      this.options = _.omit(this.options, 'SecurityToken');
      return fn();
    });
  }

  getSecurityTokenAndMyQDeviceId(options = {}) {
    return this.maybeRetry(() =>
      this.getSecurityToken(options).then(SecurityToken =>
        this.getDeviceId(options).then(MyQDeviceId => ({
          SecurityToken,
          MyQDeviceId
        }))
      )
    );
  }

  getDeviceAttribute(options = {}) {
    options = _.extend({}, this.options, options);
    const {name: AttributeName} = options;
    return this.maybeRetry(() =>
      this.getDeviceList(options)
        .then(devices => {
          let deviceId;

          if (options.MyQDeviceId) {
            deviceId = Number(options.MyQDeviceId);
          } else {
            deviceId = this.findDeviceId(devices);
          }

          const device = devices.find(device => device.MyQDeviceId === deviceId);

          const attribute = device.Attributes.find(attribute => attribute.AttributeDisplayName === AttributeName);

          return attribute.Value;
        })
    );
  }

  setDeviceAttribute(options = {}) {
    const {name: AttributeName, value: AttributeValue} = options;
    return this.maybeRetry(() =>
      this.getSecurityTokenAndMyQDeviceId(options).then(
        ({SecurityToken, MyQDeviceId}) => {
          return req({
            method: 'PUT',
            pathname: '/api/v4/DeviceAttribute/PutDeviceAttribute',
            headers: {SecurityToken},
            body: {AttributeName, AttributeValue, MyQDeviceId}
          })
        }
      )
    );
  }
};
