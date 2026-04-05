import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

// Polyfill TextEncoder / TextDecoder for Hermes (used by react-native-qrcode-svg)
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encode(str) {
      const bytes = [];
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code < 0x80) {
          bytes.push(code);
        } else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0xd800 || code >= 0xe000) {
          bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
          // surrogate pair
          i++;
          const hi = code, lo = str.charCodeAt(i);
          const cp = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
          bytes.push(
            0xf0 | (cp >> 18),
            0x80 | ((cp >> 12) & 0x3f),
            0x80 | ((cp >> 6) & 0x3f),
            0x80 | (cp & 0x3f),
          );
        }
      }
      return new Uint8Array(bytes);
    }
  };
}

AppRegistry.registerComponent(appName, () => App);
