from __future__ import annotations

import unittest

from polytheta_yfinance_downloader.source_signals import (
    ACQUISITION_PATTERNS,
    BUYBACK_PATTERNS,
    DOWNSIDE_PATTERNS,
    black_scholes_delta,
    compute_gsrs_proxy_score,
    extract_finra_short_interest_url,
    iv_percentile,
    probability_of_touch_from_delta,
    score_text_matches,
    MacroSnapshot,
)


class SourceSignalTests(unittest.TestCase):
    def test_extract_finra_short_interest_url(self) -> None:
        html = """
        <html>
          <body>
            <a href="https://cdn.finra.org/equity/otcmarket/biweekly/shrt20260313.csv">latest</a>
          </body>
        </html>
        """
        self.assertEqual(
            extract_finra_short_interest_url(html),
            "https://cdn.finra.org/equity/otcmarket/biweekly/shrt20260313.csv",
        )

    def test_black_scholes_delta_and_probability_of_touch(self) -> None:
        delta = black_scholes_delta(
            spot=20.0,
            strike=22.0,
            days_to_expiry=7,
            implied_volatility=0.65,
            option_type="call",
            risk_free_rate=0.04,
        )
        self.assertIsNotNone(delta)
        self.assertGreater(delta or 0, 0)
        self.assertLess(delta or 1, 1)
        pot = probability_of_touch_from_delta(delta)
        self.assertAlmostEqual(pot or 0, min(1.0, abs(delta or 0) * 2.0), places=4)

    def test_iv_percentile(self) -> None:
        percentile, observations = iv_percentile(0.45, [0.2, 0.3, 0.4, 0.5])
        self.assertEqual(observations, 4)
        self.assertEqual(percentile, 75.0)

    def test_keyword_scoring(self) -> None:
        self.assertTrue(score_text_matches("The board approved a new share repurchase program.", BUYBACK_PATTERNS))
        self.assertTrue(score_text_matches("The issuer is evaluating strategic alternatives and a merger.", ACQUISITION_PATTERNS))
        self.assertTrue(score_text_matches("The company disclosed a cyber incident and investigation.", DOWNSIDE_PATTERNS))

    def test_gsrs_proxy_score(self) -> None:
        snapshot = MacroSnapshot(
            as_of_date="2026-04-04",
            retrieved_at="2026-04-04T12:00:00+00:00",
            vix_close=28.0,
            vix_change_1d=3.5,
            skew_close=145.0,
            hy_oas=4.8,
            hy_oas_5y_avg=3.5,
            hy_oas_delta_vs_5y=1.3,
            move_proxy=8.0,
            equity_put_call_ratio=0.92,
            risk_free_rate_annual=0.043,
            gsrs_proxy_score=None,
        )
        score = compute_gsrs_proxy_score(snapshot)
        self.assertIsNotNone(score)
        self.assertGreater(score or 0, 0)
        self.assertLessEqual(score or 0, 10)


if __name__ == "__main__":
    unittest.main()
