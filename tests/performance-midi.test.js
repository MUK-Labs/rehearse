import test from 'node:test';
import assert from 'node:assert/strict';
import {setupPerformanceMidi} from '../js/performance-midi.js';

class Input extends EventTarget {
  constructor(id, name) {
    super();
    this.id = id;
    this.name = name;
    this.state = 'connected';
  }

  async open() {}
  async close() {}

  send(...bytes) {
    this.dispatchEvent(Object.assign(new Event('midimessage'), {data: Uint8Array.from(bytes)}));
  }
}

class Button extends EventTarget {
  disabled = false;

  setAttribute() {}

  click() {
    if (!this.disabled) this.dispatchEvent(new Event('click'));
  }
}

function setBrowserGlobals(t, globals) {
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
}

test('learned controls turn once per press and survive reload and controller reconnection', async t => {
  const pedal = new Input('pedal', 'Pedal');
  const keyboard = new Input('keyboard', 'Keyboard');
  const access = Object.assign(new EventTarget(), {
    inputs: new Map([[pedal.id, pedal], [keyboard.id, keyboard]]),
  });
  const stored = new Map();
  setBrowserGlobals(t, {
    navigator: {requestMIDIAccess: async options => {
      assert.deepEqual(options, {sysex: false});
      return access;
    }},
    document: {hidden: false},
    localStorage: {getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value)},
  });

  const turns = [];
  async function mount() {
    const controls = {
      connect: new Button(), previous: new Button(), next: new Button(), status: {},
      turn: delta => turns.push(delta),
    };
    const dispose = setupPerformanceMidi(controls);
    controls.connect.click();
    await new Promise(resolve => setImmediate(resolve));
    return {...controls, dispose};
  }

  const first = await mount();
  first.next.click();
  pedal.send(0xb0, 64, 0);
  pedal.send(0xb0, 64, 127);
  pedal.send(0xb0, 64, 100);
  assert.deepEqual(turns, []);
  assert.match(first.status.textContent, /Next · Pedal · ch\. 1 CC 64/);
  pedal.send(0xb0, 64, 0);
  keyboard.send(0xb0, 64, 127);
  pedal.send(0xb1, 64, 127);
  pedal.send(0xb0, 64, 127);
  pedal.send(0xb0, 64, 90);
  assert.deepEqual(turns, [1]);

  first.previous.click();
  keyboard.send(0x92, 60, 80);
  keyboard.send(0x82, 60, 10);
  keyboard.send(0x92, 60, 60);
  keyboard.send(0x92, 60, 60);
  keyboard.send(0x92, 60, 0);
  keyboard.send(0x92, 60, 60);
  assert.deepEqual(turns, [1, -1, -1]);
  first.dispose();

  const second = await mount();
  t.after(second.dispose);
  pedal.send(0xb0, 64, 90);
  pedal.state = 'disconnected';
  access.dispatchEvent(new Event('statechange'));
  pedal.send(0xb0, 64, 0);
  pedal.send(0xb0, 64, 127);
  assert.match(second.status.textContent, /Next · controller disconnected/);
  assert.deepEqual(turns, [1, -1, -1, 1]);

  pedal.state = 'connected';
  access.dispatchEvent(new Event('statechange'));
  pedal.send(0xb0, 64, 127);
  assert.deepEqual(turns, [1, -1, -1, 1, 1]);
});
