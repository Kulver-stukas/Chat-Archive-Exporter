# v0.1.7 rev.2 test report

- Automated browser tests use synthetic accounts, filesystem handles, worker states and ChatGPT DOM. They do not establish authenticated provider or native File System Access behavior.
- 55 Node.js test suites passed, including cancellation classification, chrome.action badge colors/labels, scoped widget summaries, routing, and frozen core.
- 10 Chromium Popup/Side Panel test scenarios passed, including local Tools/Settings and Back, canceled Save neutrality, and worker-grant-versus-popup permission labels.
- Widget Chromium test passed: disabled widget leaves legacy button hidden, short/long modes, logs, keyboard movement, toggle and dismissal resetting persistent setting.
- 31 baseline core files retained byte-for-byte. The original worker.js remains an unchanged prefix with the UI module import appended.
- Unchanged permissions and minimum Chrome compatibility.
- Browser-native user acceptance pending: badge appearance at 16px; real active writer permission transitions; actual status logs and widget positioning; original chat and Library export.
