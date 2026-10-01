<!-- An e2e fixture (#422): the sandbox tracker serves this file as the CLAUDE.md of the
     pretend repository acme-robotics/helios-console, for the knowledge leg to import. It is not
     guidance for working in this repository. -->

# Helios console

Guidance for agents working on the operator console.

## Pairing flow

The pairing screen talks to the device over BLE GATT and has to stay usable offline.

- Always debounce pairing requests by 300 ms.
- Never store a pairing key in localStorage.

## Telemetry charts

Charts read the telemetry service's downsampled series, never the raw stream.

- Use the `useSeries` hook for every chart.
