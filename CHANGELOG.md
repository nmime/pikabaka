# Changelog

## [2.5.0](https://github.com/nmime/pikabaka/compare/v2.4.0...v2.5.0) (2026-06-24)


### Features

* **companion:** add local phone companion MVP ([c2c536f](https://github.com/nmime/pikabaka/commit/c2c536fd6419aab9541f18f3e9ef5e0ed311e91d))
* **companion:** add trusted phone web companion ([6e75fac](https://github.com/nmime/pikabaka/commit/6e75fac1f88f352f2eea088d4da88e1db081bdf7))
* **settings:** add Auto (multi-language) STT option, gate Azure/IBM ([#6](https://github.com/nmime/pikabaka/issues/6)) ([#12](https://github.com/nmime/pikabaka/issues/12)) ([5369ec3](https://github.com/nmime/pikabaka/commit/5369ec311b4a94907994ca548627f29d81e42c24))
* **settings:** add full config backup and restore ([f239e11](https://github.com/nmime/pikabaka/commit/f239e11ae22cb4f88256e78f48ff38c79dfa25fa))
* **stt:** Deepgram multi-language auto-detect ([#2](https://github.com/nmime/pikabaka/issues/2)) ([#9](https://github.com/nmime/pikabaka/issues/9)) ([aef38c5](https://github.com/nmime/pikabaka/commit/aef38c57a71bdff14cb9c5f969e46f7e57f0bd5c))
* **stt:** Google alternativeLanguageCodes for auto ([#3](https://github.com/nmime/pikabaka/issues/3)) ([#8](https://github.com/nmime/pikabaka/issues/8)) ([745a65c](https://github.com/nmime/pikabaka/commit/745a65c44653e5e9f9b8bfba7323ed2df4ec39bd))
* **stt:** OpenAI/Groq Whisper auto-detect language ([#4](https://github.com/nmime/pikabaka/issues/4)) ([#11](https://github.com/nmime/pikabaka/issues/11)) ([b9ed1ab](https://github.com/nmime/pikabaka/commit/b9ed1abb6cc2200bfb8f78d6c91817a626b1d3c3))
* **stt:** Soniox emit detectedLanguage ([#5](https://github.com/nmime/pikabaka/issues/5)) ([#10](https://github.com/nmime/pikabaka/issues/10)) ([02fa893](https://github.com/nmime/pikabaka/commit/02fa8930eee2e5d16d5297e8fbd4896fa3574b4a))
* **transcript:** per-segment language badge + translation copy update ([#7](https://github.com/nmime/pikabaka/issues/7)) ([#13](https://github.com/nmime/pikabaka/issues/13)) ([43bd978](https://github.com/nmime/pikabaka/commit/43bd9787abd3cb1d33d4496535666c1c6e7dcf05))
* **translation:** target-language-only translation + detectedLanguage plumbing ([6cf0037](https://github.com/nmime/pikabaka/commit/6cf0037df9119f626cf0135fa78aea7ac675a5dd))


### Bug Fixes

* attach screenshots, pasted images, model labels, and stream status ([ce1dff9](https://github.com/nmime/pikabaka/commit/ce1dff922ca50e7e02717a7c0bc1c9aa16f06670))
* auto fallback silent output and compact warning ([2232957](https://github.com/nmime/pikabaka/commit/2232957f19a2e3ce1de6aaf9b0fff87a725fc301))
* **ci:** use pnpm in build-smoke workflow ([#14](https://github.com/nmime/pikabaka/issues/14)) ([bacaae9](https://github.com/nmime/pikabaka/commit/bacaae9e8e59b5600f0d253c853b38a9bdb753c0))
* compact transcript pane resizing ([f39542d](https://github.com/nmime/pikabaka/commit/f39542d9bfbdbe0e1c5321e2bfc25da4de22a15d))
* dedupe chat controls across UI states ([f5f910c](https://github.com/nmime/pikabaka/commit/f5f910c55595743a4c61a0c93611cf415892ce8d))
* dedupe overlay controls and improve small chat layout ([0c28db8](https://github.com/nmime/pikabaka/commit/0c28db86b31dc0aa647170eee48be76f2bd9431d))
* default STT recognition to auto language ([0efe94a](https://github.com/nmime/pikabaka/commit/0efe94afb5cc4527bcd8f468eb8262e20e089ba4))
* harden live transcript audio permissions ([c510744](https://github.com/nmime/pikabaka/commit/c510744b85c618f970c60b2570bc77083a348089))
* keep system audio live without mic grant ([26e2b82](https://github.com/nmime/pikabaka/commit/26e2b82ebff0d61b5fc8a653c614f0072434b628))
* keep system audio separate from mic STT ([9de925b](https://github.com/nmime/pikabaka/commit/9de925bbbd4c08b853b1855d831f47cc3d08a48f))
* launch overlay at compact modal size ([ede3f0f](https://github.com/nmime/pikabaka/commit/ede3f0f4c5c9827c09e6dba8056f1436954d7fd3))
* **mac:** stabilize screen permission identity, screenshots, and chat modal ([a735dc7](https://github.com/nmime/pikabaka/commit/a735dc71a3eaf604859a443893beed4486f0ed29))
* make overlay panes responsive columns ([7d1d7da](https://github.com/nmime/pikabaka/commit/7d1d7da9a5cfd710f296ae586bce608077287b32))
* open overlay at usable expanded size ([80acc75](https://github.com/nmime/pikabaka/commit/80acc758c665b4a7746bb67f7ca7c24fbbb52057))
* polish chat screenshot layout and STT errors ([9fbd7d9](https://github.com/nmime/pikabaka/commit/9fbd7d9869aa890050f3daee9fbbefe72d75f11d))
* polish live transcript health and multilingual STT ([b3a6502](https://github.com/nmime/pikabaka/commit/b3a650257bdcaaad1ce0f0598d5da8780dd6682d))
* preserve mono CoreAudio tap samples ([2c4866e](https://github.com/nmime/pikabaka/commit/2c4866ebbc50e3f50010d91678bf9934d0d1b8ed))
* restore chat pause stop drag controls ([806813b](https://github.com/nmime/pikabaka/commit/806813b53ecaf22a4abf016b3b942d74d2741f9f))
* restore Deepgram live transcript auto mode ([548c76f](https://github.com/nmime/pikabaka/commit/548c76f2d0369b87eb36b33c91bc6925aea78a14))
* **settings:** dedupe config location display ([ed8635c](https://github.com/nmime/pikabaka/commit/ed8635c1b462551ec51abc9013ff1c0ca781dd8c))
* **settings:** preserve language defaults and streaming ([36584c7](https://github.com/nmime/pikabaka/commit/36584c74100cee4cd69d272a3fc7d5e3d84b101a))
* **settings:** render phone companion panel ([7cce1fc](https://github.com/nmime/pikabaka/commit/7cce1fc9cc7b7d3f1218ecf0385429994a50da32))
* shrink overlay launch and settle cropper capture ([495d743](https://github.com/nmime/pikabaka/commit/495d7431d433c0d3dd021b5c6b6e4bb5a36e5092))
* stabilize overlay chat UI and macOS permissions ([5bb9c83](https://github.com/nmime/pikabaka/commit/5bb9c83a7eeb8d70b52ee69d75dfe0098ac78a0c))
* stream microphone STT continuously ([9083055](https://github.com/nmime/pikabaka/commit/9083055edcdd9894838a8293ef175f903440e0c0))


### Build & Release

* add scripts/release.js for one-shot release publishing ([3318e4b](https://github.com/nmime/pikabaka/commit/3318e4b5c9031e2fb105029e760d22fdc7bb0f96))
* **mac:** fix code signing and notarization pipeline ([cb8f752](https://github.com/nmime/pikabaka/commit/cb8f7526da518a34e29b1ac96a890282da254392))


### Refactoring

* add launcher history components ([88f301a](https://github.com/nmime/pikabaka/commit/88f301ab680832f1e56e74cd772264ed9adf483f))
* modernize launcher and meeting UI ([a43effc](https://github.com/nmime/pikabaka/commit/a43effc2989161fcefc7579f3ef00f6f9a46c2a7))
* move submitPrompt/handlers to useMeetingChat, remove duplication ([db91b19](https://github.com/nmime/pikabaka/commit/db91b191b01b2e3620c1cf7133bf9a3f926b9272))
* PikaInterface thin shell using useMeeting* hooks ([2367dbe](https://github.com/nmime/pikabaka/commit/2367dbecbed2ec24f11fac9f4013b81417ebef17))
* remove duplicate handlers from PikaInterface, target 500 lines ([56c6911](https://github.com/nmime/pikabaka/commit/56c69115d61552b3eac0ce8ab9f4344b7cd7ea25))

## [2.4.0](https://github.com/nmime/pikabaka/compare/v2.3.0...v2.4.0) (2026-06-16)


### Features

* **companion:** add trusted phone web companion ([6e75fac](https://github.com/nmime/pikabaka/commit/6e75fac1f88f352f2eea088d4da88e1db081bdf7))
* **settings:** add full config backup and restore ([f239e11](https://github.com/nmime/pikabaka/commit/f239e11ae22cb4f88256e78f48ff38c79dfa25fa))


### Bug Fixes

* attach screenshots, pasted images, model labels, and stream status ([3338869](https://github.com/nmime/pikabaka/commit/3338869aa3ba3bce73a19d900235b378462f9e49))
* compact transcript pane resizing ([5daad22](https://github.com/nmime/pikabaka/commit/5daad22328c4e01ba530a74ee94ac698cf54c2b2))
* dedupe chat controls across UI states ([ba707ea](https://github.com/nmime/pikabaka/commit/ba707ea520ce6a92af434870c0d16bd1b8f19cc4))
* dedupe overlay controls and improve small chat layout ([a164a2a](https://github.com/nmime/pikabaka/commit/a164a2a0e92e4053632cb027a35b4f3f1ae77bcb))
* harden live transcript audio permissions ([823c705](https://github.com/nmime/pikabaka/commit/823c705c61e5b2a98ff9dba8e44f94641e2eb44b))
* keep system audio live without mic grant ([4a012d6](https://github.com/nmime/pikabaka/commit/4a012d6a74f72524c53aaaf59e15cc77792e95ac))
* launch overlay at compact modal size ([fd7090b](https://github.com/nmime/pikabaka/commit/fd7090b984f7af7e6333cc1a546cf283d1182053))
* **mac:** stabilize screen permission identity, screenshots, and chat modal ([3594117](https://github.com/nmime/pikabaka/commit/35941171c58dd8deab3d55ea5436550f7c643448))
* make overlay panes responsive columns ([4c1e593](https://github.com/nmime/pikabaka/commit/4c1e59328ce65f840555249a0e0dbef0acf159ad))
* open overlay at usable expanded size ([a1aec8b](https://github.com/nmime/pikabaka/commit/a1aec8b1e91f4f8ac26949002a7063d4825ff7a2))
* polish chat screenshot layout and STT errors ([0cff19d](https://github.com/nmime/pikabaka/commit/0cff19d11cfff1d28b1bf3bc032f8c353913e9ca))
* restore chat pause stop drag controls ([4dc2f2e](https://github.com/nmime/pikabaka/commit/4dc2f2e492850792a87005f0d8ea26c20e2ee403))
* restore Deepgram live transcript auto mode ([aab40ef](https://github.com/nmime/pikabaka/commit/aab40efac51b1def104a258326c70d90bfb56485))
* **settings:** dedupe config location display ([dc31822](https://github.com/nmime/pikabaka/commit/dc318222dbb353968a875e0b776ed214cd800336))
* **settings:** dedupe config location display ([ed8635c](https://github.com/nmime/pikabaka/commit/ed8635c1b462551ec51abc9013ff1c0ca781dd8c))
* **settings:** preserve language defaults and streaming ([36584c7](https://github.com/nmime/pikabaka/commit/36584c74100cee4cd69d272a3fc7d5e3d84b101a))
* **settings:** render phone companion panel ([36b7006](https://github.com/nmime/pikabaka/commit/36b700660fc8ecc03d4a1525f9881a51704c9c8c))
* shrink overlay launch and settle cropper capture ([dfedc8c](https://github.com/nmime/pikabaka/commit/dfedc8cb417c8d9a0b4345e7b1ed6529a1bee201))
* stabilize overlay chat UI and macOS permissions ([32feda6](https://github.com/nmime/pikabaka/commit/32feda695da37ff542c5ffe8b8c4c488bb9b4264))

## [2.3.0](https://github.com/nmime/pikabaka/compare/v2.2.0...v2.3.0) (2026-06-14)

### Features

* **companion:** add local phone companion MVP ([#2](https://github.com/nmime/pikabaka/pull/2)) ([c2c536f](https://github.com/nmime/pikabaka/commit/c2c536fd6419aab9541f18f3e9ef5e0ed311e91d))

### Bug Fixes

* preserve language defaults and OpenAI-compatible streaming fixes ([dd843f7](https://github.com/nmime/pikabaka/commit/dd843f7a967fed9deb740be589c75f15e61aeff3))

## [2.2.0](https://github.com/royisme/pikabaka/compare/v2.1.0...v2.2.0) (2026-05-06)


### Features

* **settings:** add Auto (multi-language) STT option, gate Azure/IBM ([#6](https://github.com/royisme/pikabaka/issues/6)) ([#12](https://github.com/royisme/pikabaka/issues/12)) ([5369ec3](https://github.com/royisme/pikabaka/commit/5369ec311b4a94907994ca548627f29d81e42c24))
* **stt:** Deepgram multi-language auto-detect ([#2](https://github.com/royisme/pikabaka/issues/2)) ([#9](https://github.com/royisme/pikabaka/issues/9)) ([aef38c5](https://github.com/royisme/pikabaka/commit/aef38c57a71bdff14cb9c5f969e46f7e57f0bd5c))
* **stt:** Google alternativeLanguageCodes for auto ([#3](https://github.com/royisme/pikabaka/issues/3)) ([#8](https://github.com/royisme/pikabaka/issues/8)) ([745a65c](https://github.com/royisme/pikabaka/commit/745a65c44653e5e9f9b8bfba7323ed2df4ec39bd))
* **stt:** OpenAI/Groq Whisper auto-detect language ([#4](https://github.com/royisme/pikabaka/issues/4)) ([#11](https://github.com/royisme/pikabaka/issues/11)) ([b9ed1ab](https://github.com/royisme/pikabaka/commit/b9ed1abb6cc2200bfb8f78d6c91817a626b1d3c3))
* **stt:** Soniox emit detectedLanguage ([#5](https://github.com/royisme/pikabaka/issues/5)) ([#10](https://github.com/royisme/pikabaka/issues/10)) ([02fa893](https://github.com/royisme/pikabaka/commit/02fa8930eee2e5d16d5297e8fbd4896fa3574b4a))
* **transcript:** per-segment language badge + translation copy update ([#7](https://github.com/royisme/pikabaka/issues/7)) ([#13](https://github.com/royisme/pikabaka/issues/13)) ([43bd978](https://github.com/royisme/pikabaka/commit/43bd9787abd3cb1d33d4496535666c1c6e7dcf05))
* **translation:** target-language-only translation + detectedLanguage plumbing ([6cf0037](https://github.com/royisme/pikabaka/commit/6cf0037df9119f626cf0135fa78aea7ac675a5dd))


### Bug Fixes

* **ci:** use pnpm in build-smoke workflow ([#14](https://github.com/royisme/pikabaka/issues/14)) ([bacaae9](https://github.com/royisme/pikabaka/commit/bacaae9e8e59b5600f0d253c853b38a9bdb753c0))


### Build & Release

* add scripts/release.js for one-shot release publishing ([3318e4b](https://github.com/royisme/pikabaka/commit/3318e4b5c9031e2fb105029e760d22fdc7bb0f96))


### Refactoring

* add launcher history components ([88f301a](https://github.com/royisme/pikabaka/commit/88f301ab680832f1e56e74cd772264ed9adf483f))
* modernize launcher and meeting UI ([a43effc](https://github.com/royisme/pikabaka/commit/a43effc2989161fcefc7579f3ef00f6f9a46c2a7))
