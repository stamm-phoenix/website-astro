import { describe, expect, test } from 'bun:test';
import { navigationLink, placeLink, prefersAppleMaps } from '../src/lib/nikolausMaps';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('map links', () => {
  test('Apple devices open Apple Maps, all others Google Maps', () => {
    expect(prefersAppleMaps(IPHONE)).toBe(true);
    expect(prefersAppleMaps(IPAD)).toBe(true);
    expect(prefersAppleMaps(ANDROID)).toBe(false);
    expect(prefersAppleMaps(WINDOWS)).toBe(false);
    expect(prefersAppleMaps('')).toBe(false);
  });

  test('a place opens at its coordinates', () => {
    expect(placeLink(47.9, 11.8, false)).toBe(
      'https://www.google.com/maps/search/?api=1&query=47.9%2C11.8'
    );
    expect(placeLink(47.9, 11.8, true)).toBe(
      'https://maps.apple.com/?ll=47.9,11.8&q=47.9%2C11.8&z=17'
    );
  });

  test('navigation leads to the destination by car', () => {
    expect(navigationLink('Hauptstraße 1, 83620 Feldkirchen', false)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Hauptstra%C3%9Fe%201%2C%2083620%20Feldkirchen&travelmode=driving'
    );
    expect(navigationLink('47.9,11.8', true)).toBe(
      'https://maps.apple.com/?daddr=47.9%2C11.8&dirflg=d'
    );
  });
});
