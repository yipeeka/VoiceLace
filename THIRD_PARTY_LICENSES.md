# Third-Party Models and Licenses

VoiceLace is licensed as source code under Apache-2.0. Model weights,
external engines, datasets, and package dependencies keep their own licenses.
Installing or configuring a model in VoiceLace does not change that model's
license.

This file is a practical guide, not legal advice. Before distributing a build,
model bundle, generated asset, or hosted service, check the exact license text
and model card for every component you include.

## Reference Projects

| Component | Typical use in VoiceLace | Upstream license signal | VoiceLace treatment |
|---|---|---|---|
| ACE-Step / ACE-Step 1.5 | Local music generation | MIT license in the upstream project | Third-party model/project. Follow upstream MIT terms and any model-card terms for checkpoints. |
| VoxCPM / VoxCPM2 | Text-to-speech and voice cloning backend | Apache-2.0 license in the upstream project | Third-party model/project. Follow upstream Apache-2.0 terms, notices, and any model-card or weight terms. |
| OmniVoice | Text-to-speech and voice cloning backend | Apache-2.0 license in the upstream project | Third-party model/project. Follow upstream Apache-2.0 terms, notices, and any model-card or weight terms. |
| Whisper, Qwen3-ASR, CrispASR, Pyannote, llama-cpp-python, FFmpeg, frontend/backend packages | ASR, diarization, LLM parsing, audio/video tooling, UI/runtime dependencies | Varies by project and package | Keep each dependency's license, notice, model-card requirements, and usage restrictions. |

## What VoiceLace Licenses

The Apache-2.0 license in `LICENSE` covers VoiceLace source code,
configuration examples, scripts, and documentation authored for this
repository, unless a file states otherwise.

The VoiceLace license does not cover:

- Third-party model weights or checkpoints.
- Third-party source code copied into a local installation.
- Datasets used to train or fine-tune models.
- Voices, samples, prompts, scripts, subtitles, music, audio, images, or video
  that users import into the application.
- Generated outputs, except for the parts, if any, that are independently
  copyrighted by VoiceLace.

## Generated Outputs

VoiceLace does not claim ownership of user inputs or generated outputs. Rights
in generated audio, music, subtitles, scripts, projects, or videos depend on
the user's inputs, the selected model's license, applicable law, and any
third-party rights in voices, performances, recordings, text, music, or other
materials.

When generating cloned or synthetic voices, users should keep evidence of
consent, source ownership, and model permissions. When publishing or
commercializing outputs, users should review the selected model license and
the laws that apply to the target region.

## Redistribution Guidance

When redistributing VoiceLace:

- Include `LICENSE`, `NOTICE`, `THIRD_PARTY_LICENSES.md`, and
  `RESPONSIBLE_USE.md`.
- Include third-party license and notice files for every bundled dependency,
  model, checkpoint, executable, or asset.
- Do not bundle model weights unless their license permits redistribution.
- Do not imply that VoiceLace grants rights to a third-party model, voice,
  dataset, or generated output.
- Preserve attribution required by Apache-2.0, MIT, and other applicable
  licenses.

## Recommended Project Policy

VoiceLace should stay permissive for code and strict about provenance:

- Source code: Apache-2.0.
- Project notices: `NOTICE`.
- Third-party models and assets: original upstream licenses.
- User inputs and outputs: owned or controlled by the user, subject to
  upstream model terms and applicable law.
- Responsible use: documented in `RESPONSIBLE_USE.md`.
