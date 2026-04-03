import * as device from "./device.js";

const INITIALIZER_MODULE_REF = new URL("../initializer.js", import.meta.url);

export const initialize = globalThis.space.extend(
  INITIALIZER_MODULE_REF,
  async function initialize() {
    await setDeviceClass();
  }
);

const setDeviceClass = globalThis.space.extend(
  INITIALIZER_MODULE_REF,
  async function setDeviceClass() {
    const type = await device.determineInputType();
    const body = document.body;

    body.classList.forEach((className) => {
      if (className.startsWith("device-")) {
        body.classList.remove(className);
      }
    });

    body.classList.add(`device-${type}`);
  }
);
