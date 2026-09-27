const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
const context = vm.createContext({
  HTMLElement: class {}, window: {},
  customElements: { define: (name, value) => elements.set(name, value) },
});
vm.runInContext(readFileSync(require('node:path').join(__dirname, '../track-history-card.js'), 'utf8'), context);
const Card = elements.get('lovelace-track-history-card');
function card(config = {}) {
  const c = Object.create(Card.prototype);
  c._config = { theme: 'system', ...config };
  c._hass = { themes: { darkMode: false } };
  return c;
}
const custom = {
  url: 'https://tiles.example/{z}/{x}/{y}.png?key={api_key}',
  attribution: 'Example provider',
};
test('both defaults use CARTO with correct attribution', () => {
  const c = card();
  assert.match(c._tileConfig('light').url, /cartocdn.com\/light_all\//);
  assert.match(c._tileConfig('dark').url, /cartocdn.com\/dark_all\//);
  assert.match(c._tileConfig('light').options.attribution, /OpenStreetMap.*CARTO/);
});
test('custom theme, global key, per-theme key precedence and URL encoding', () => {
  const c = card({ tile_api_key: 'a&b', tile_layers: { light: custom } });
  assert.match(c._tileConfig('light').url, /key=a%26b$/);
  assert.match(c._tileConfig('dark').url, /cartocdn/);
  c._config.tile_layers.light = { ...custom, api_key: 'own key', max_zoom: 17, subdomains: ['a', 'b'] };
  const tile = c._tileConfig('light');
  assert.match(tile.url, /key=own%20key$/);
  assert.equal(tile.options.maxZoom, 17);
  assert.equal(tile.options.attribution, 'Example provider');
});
test('rejects malformed config and missing credentials without leaking keys', () => {
  for (const config of [
    { tile_layers: [] }, { tile_layers: { light: 'bad' } },
    { tile_layers: { light: custom } },
    { tile_layers: { light: { ...custom, url: 'javascript:bad' } } },
    { tile_layers: { light: { url: 'https://tiles.example/{z}/{x}/{y}' } } },
    { tile_layers: { light: { ...custom, api_key: 'secret', max_zoom: 99 } } },
  ]) assert.throws(() => card(config)._tileConfig('light'), error => !error.message.includes('secret'));
});
test('reuses unchanged tiles and replaces only when settings change', () => {
  const c = card();
  let adds = 0, removes = 0;
  c._map = { removeLayer: () => removes++ };
  const L = { tileLayer: (url, options) => ({ url, options, addTo: () => adds++ }) };
  c._ensureTileLayer(L);
  c._ensureTileLayer(L);
  assert.equal(adds, 1);
  c._hass.themes.darkMode = true;
  c._ensureTileLayer(L);
  assert.equal(adds, 2);
  assert.equal(removes, 1);
  assert.match(c._tileLayer.url, /dark_all/);
  c._config.tile_layers = { dark: { ...custom, api_key: 'one' } };
  c._ensureTileLayer(L);
  c._config.tile_layers.dark.api_key = 'two';
  c._ensureTileLayer(L);
  assert.equal(adds, 4);
  assert.match(c._tileLayer.url, /key=two$/);
});
test('HA theme updates refresh tiles immediately without fetching history', () => {
  const c = card();
  c._autoLoaded = true;
  c._map = {};
  c._L = {};
  let updates = 0;
  c._ensureTileLayer = () => updates++;
  c._onLoad = () => { throw Error('unexpected history reload'); };
  c.hass = { themes: { darkMode: true } };
  assert.equal(updates, 1);
  assert.equal(c._resolveTheme(), 'dark');
  c._config.theme = 'light';
  assert.equal(c._resolveTheme(), 'light');
});
