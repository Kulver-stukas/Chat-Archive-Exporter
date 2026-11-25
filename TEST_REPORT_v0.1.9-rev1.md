# TEST REPORT — Chat Archive Exporter v0.1.9 rev.1

Дата: 2026-11-25.
Основа: предоставленный chat-archive-exporter-v0.1.8-rev1-source.zip.
SHA-256 основы: 3064821db709f2090d967e392e3408b2cd8a6063c3d27c17073875aa1620b53f.

## Результат

**70 из 70 Node test suites прошли.** Это включает все 62 набора исходной v0.1.8 и восемь новых. Node.js v24.22.3.

Provider API, extension messaging, browser downloads, permissions и IndexedDB backend в автоматических тестах подменены. Blob, сериализация, хеширование, ZIP и проверка упакованных байтов выполняются настоящим кодом проекта. Успех этих тестов не считается authenticated Chrome/Edge UAT.

## Новые тесты

| Suite | Что проверено |
| --- | --- |
| export-selection.test.js | Все 31 непустая комбинация категорий; независимый Thinking, группировка ответов, selected IDs/branch binding, пустой результат |
| attachment-selection.test.js | Uploaded/generated provenance, attachments-only, sandbox/file pointers, дедуп по ID, исключённые сообщения, безопасные относительные пути |
| export-preferences.test.js | Defaults, сериализация одновременных PATCH разных полей, monotonic revision, сохранение после worker restart, отказ malformed patch |
| attachment-api.test.js | Verified workspace, точный message+locator, file ID и sandbox resolver, настоящий message.id, unavailable/expired, запрет произвольного URL |
| content-attachment-bridge.test.js | Новый bounded original transfer через существующий content bridge; закрытие и обработка ошибок |
| manual-selection-jobs.test.js | Immutable selection; только выбранные originals; durable checkpoint/restart без повторного transfer; Stop; лимиты; stale branch; повреждённый снимок/оригинал; terminal unavailable 403 |
| manual-selection-output.test.js | Настоящий MD/ZIP; список members, CRC, исходные бинарные байты, relative links, report; отсутствие snapshot/невыбранных текстов/Vault prefix; idempotent Blob URL |
| manual-selection-failure.test.js | Недоступный файл не блокирует следующий; persistent chat 404/malformed mapping завершается после ограниченных повторов без цикла и пустого download |

## Регрессия

Проверены существующие normalize/message-header/LaTeX/citation tests; manual jobs, Source transfer, Vault recovery, Library dedup/provenance, background lifecycle, permissions, chat cache и UI worker routes.

В tests/lifecycle-safety.test.js ожидаемое поведение обновлено под явное требование не добавлять кнопку на страницу: проверяются отсутствие новой кнопки, удаление старого элемента и отсутствие legacy polling. tests/tab-bootstrap.test.js проверяет новый порядок внедрения selection helper. Изменение gate ui-frozen-core.test.js ограничено явно затронутыми модулями; остальные архивные модули и прежние worker routes проверяются по исходным хешам. Chrome permissions, host_permissions и minimum_chrome_version сохранены.

## Исправления, выявленные при интеграции и независимом review

1. Сохранение selection staging под исходным workspace prefix с удалением этого prefix только из выходных ZIP paths.
2. Контрольная сумма внутреннего snapshot; исключение snapshot из результата.
3. File-specific HTTP 403 с ATTACHMENT_UNAVAILABLE не превращается в бесконечное ожидание авторизации.
4. Persistent ошибка получения текущего разговора завершает selected job после ограниченных повторов.
5. Explicit uploaded provenance и повтор уже загруженного file ID не превращаются в generated из-за роли assistant.
6. Порядок preference events/replies определяется persisted revision; field patches не затирают параллельные настройки.
7. Selection invalidation относится к своему окну и вкладке, включая незавершённую загрузку.
8. Перед submit повторно проверяются текущий conversation, workspace и активная вкладка.

## Статические проверки

- JavaScript syntax для runtime файлов.
- HTML: уникальные IDs, существующие script/link resources, selection helper загружается до normalizer и panel.js.
- Python browser suites успешно компилируются.
- Manifest и состав install/source ZIP проверяются при упаковке.

## Браузерная проверка — не выполнена

tests/selective-export-ui-browser.py подготовлен для реального Chromium с подменёнными provider/extension API. Он покрывает split button, tri-state, keyboard Escape, global settings, selector, file-only export, SPA invalidation, ошибки загрузки, 320 px и тёмную тему.

В текущем окружении /usr/bin/chromium является launcher без исполняемого Chromium. Установка Playwright Chromium получила HTTP 403. Cloud browser находится в другом окружении и не может открыть локальный HTTP-сервер. Поэтому **новые интерактивные проверки и старые browser smoke suites здесь не запускались успешно**. Синтаксические проверки и подготовка тестов не засчитываются за браузерный прогон.

Не проверялись реальные signed-in ChatGPT, актуальные ответы закрытых provider endpoints, native Save/permissions, ОС sleep/resume и физический Chrome/Edge restart. Для этого предусмотрен UAT_v0.1.9-rev1.md.

## Область изменений

Новая функция относится к Download MD текущего разговора. Save to Vault, пакетный архив и background capture используют полный формат. Новые настройки не меняют уже принятые задания. Source/Vault schemas, текущие пути и списки браузерных разрешений не мигрируют.

Сборка является тестовой; успешные automated tests не означают опубликованный stable release.

