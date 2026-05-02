from __future__ import annotations

import unittest

from backend.models.project import SynthesisConfig


class SynthesisConfigCompatTest(unittest.TestCase):
    def test_legacy_top_level_fields_hydrate_omnivoice(self) -> None:
        config = SynthesisConfig(num_step=44, guidance_scale=3.2, denoise=False)
        self.assertEqual(config.omnivoice.num_step, 44)
        self.assertAlmostEqual(config.omnivoice.guidance_scale, 3.2)
        self.assertFalse(config.omnivoice.denoise)

    def test_nested_omnivoice_fields_sync_legacy_values(self) -> None:
        config = SynthesisConfig(omnivoice={"num_step": 28, "guidance_scale": 1.8, "denoise": True})
        self.assertEqual(config.num_step, 28)
        self.assertAlmostEqual(config.guidance_scale, 1.8)
        self.assertTrue(config.denoise)


if __name__ == "__main__":
    unittest.main()
