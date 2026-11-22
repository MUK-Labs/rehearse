const storageKey = 'rehearse.performance.midi';
const directions = ['previous', 'next'];

function readBindings() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return Object.fromEntries(directions.map(direction => {
      const binding = saved?.[direction];
      return [direction, typeof binding?.port === 'string' && typeof binding?.control === 'string' ? binding : null];
    }));
  } catch {
    return {previous: null, next: null};
  }
}

function readControl(data) {
  if (data.length !== 3) return null;
  const [status, number, value] = data;
  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  if (kind === 0x80 || kind === 0x90) {
    return {control: `ch. ${channel} note ${number}`, down: kind === 0x90 && value > 0};
  }
  if (kind === 0xb0 && number < 120) {
    return {control: `ch. ${channel} CC ${number}`, down: value >= 64};
  }
  return null;
}

export function setupPerformanceMidi({connect, previous, next, status, turn}) {
  if (!navigator.requestMIDIAccess) {
    connect.disabled = previous.disabled = next.disabled = true;
    status.textContent = 'This browser cannot receive MIDI. Use the arrow keys or a keyboard-style pedal.';
    return () => {};
  }

  const buttons = {previous, next};
  const bindings = readBindings();
  const inputs = new Map();
  let access;
  let learning = null;
  let disposed = false;
  let storageUnavailable = false;

  function updateStatus() {
    for (const direction of directions) {
      buttons[direction].disabled = inputs.size === 0;
      buttons[direction].setAttribute('aria-pressed', String(learning === direction));
    }
    const summary = directions.map(direction => {
      const binding = bindings[direction];
      const label = direction === 'previous' ? 'Previous' : 'Next';
      if (!binding) return `${label} unassigned`;
      const input = inputs.get(binding.port)?.input;
      const device = input?.name || (input ? 'MIDI input' : 'controller disconnected');
      return `${label} · ${device} · ${binding.control}`;
    }).join(' / ');

    if (learning) {
      status.textContent = `Press the MIDI control for ${learning === 'next' ? 'the next' : 'the previous'} view.`;
    } else if (!inputs.size) {
      status.textContent = 'MIDI is enabled. Connect a MIDI controller.';
    } else {
      status.textContent = storageUnavailable ? `${summary}. Saving MIDI assignments is unavailable.` : summary;
    }
  }

  function onMessage(port, held, event) {
    const message = readControl(event.data);
    if (!message) return;
    const {control, down} = message;
    if (!down) {
      held.delete(control);
      return;
    }
    if (held.has(control)) return;
    held.add(control);
    if (document.hidden) return;

    const matches = direction => bindings[direction]?.port === port && bindings[direction].control === control;
    if (learning) {
      for (const direction of directions) {
        if (matches(direction)) bindings[direction] = null;
      }
      bindings[learning] = {port, control};
      learning = null;
      try {
        localStorage.setItem(storageKey, JSON.stringify(bindings));
      } catch {
        storageUnavailable = true;
      }
      updateStatus();
      return;
    }
    if (matches('previous')) turn(-1);
    if (matches('next')) turn(1);
  }

  function syncInputs() {
    const connected = new Map([...access.inputs].filter(([, input]) => input.state === 'connected'));
    for (const [id, {input, listener}] of inputs) {
      if (connected.get(id) === input) continue;
      input.removeEventListener('midimessage', listener);
      inputs.delete(id);
    }
    for (const [id, input] of connected) {
      if (inputs.has(id)) continue;
      const held = new Set();
      const listener = event => onMessage(id, held, event);
      inputs.set(id, {input, listener});
      input.addEventListener('midimessage', listener);
      input.open().catch(() => {
        if (inputs.get(id)?.input !== input) return;
        input.removeEventListener('midimessage', listener);
        inputs.delete(id);
        if (!inputs.size) learning = null;
        updateStatus();
        status.textContent = 'The browser could not open the MIDI controller. Reconnect it and try again.';
      });
    }
    if (!inputs.size) learning = null;
    updateStatus();
  }

  async function enable() {
    connect.disabled = true;
    try {
      const granted = await navigator.requestMIDIAccess({sysex: false});
      if (disposed) return;
      access = granted;
      access.addEventListener('statechange', syncInputs);
      syncInputs();
      connect.textContent = 'MIDI enabled';
    } catch (error) {
      if (disposed) return;
      connect.disabled = false;
      status.textContent = error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
        ? 'MIDI permission was denied. Allow MIDI in your browser and try again.'
        : 'MIDI could not start. Check your controller and try again.';
    }
  }

  function learn(direction) {
    learning = learning === direction ? null : direction;
    updateStatus();
  }

  const learnPrevious = () => learn('previous');
  const learnNext = () => learn('next');
  previous.disabled = next.disabled = true;
  connect.addEventListener('click', enable);
  previous.addEventListener('click', learnPrevious);
  next.addEventListener('click', learnNext);

  return () => {
    disposed = true;
    connect.removeEventListener('click', enable);
    previous.removeEventListener('click', learnPrevious);
    next.removeEventListener('click', learnNext);
    access?.removeEventListener('statechange', syncInputs);
    for (const {input, listener} of inputs.values()) {
      input.removeEventListener('midimessage', listener);
      void input.close().catch(() => {});
    }
    inputs.clear();
  };
}
