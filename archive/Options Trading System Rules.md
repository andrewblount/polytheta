**TRADING SYSTEM CHECKLIST – Spreadsheet-Ready Reference Document**  
**Version:** Final (March 10, 2026)  
**Purpose:** Complete, self-contained reference you can copy-paste directly into Excel, Google Sheets, or any checklist tool.  
**How to use:** Select the entire table below, copy, and paste into a spreadsheet. Each row is one rule/formula. Columns are designed for easy sorting/filtering.

### 1. Core Parameters & Objective
| Section                  | Rule / Formula                                      | Weighting / Threshold                  | Notes / Implication                                                                 |
|--------------------------|-----------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------------------|
| Account Size             | Default $1,000,000 (scale linearly)                 | N/A                                    | All calculations use this base; adjust proportionally for any account size          |
| Daily Target             | 1% average net daily gain on total equity           | N/A                                    | Aggressive goal; achieved through theta decay on both sides                         |
| Leverage                 | 4× portfolio margin (IBKR/Schwab)                   | N/A                                    | Cash required = total margin used ÷ 4                                               |
| Expiration               | Weekly options expiring exactly 1 week from Monday entry (preferred) or 7–14 DTE | N/A                                    | Shorter DTE accelerates theta realization                                           |

### 2. Universe Filter (Mandatory)
| Section                  | Rule / Formula                                      | Weighting / Threshold                  | Notes / Implication                                                                 |
|--------------------------|-----------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------------------|
| Exchange                 | NYSE or NASDAQ                                      | N/A                                    | Must be major US exchange                                                           |
| Price Range              | $8.00 – $40.00                                      | N/A                                    | Ensures liquid options market and meaningful premiums                               |
| Options Liquidity        | ≥500 contracts average daily volume on OTM strikes; bid-ask ≤ $0.10–$0.15 | N/A                                    | Required for clean execution                                                        |
| IV Rank                  | ≥80th percentile                                    | N/A                                    | Rich premium environment required for theta edge                                    |

### 3. Thesis Confirmation (Must meet ≥3 of 5 weighted signals)
**Call Side (Weak Names)**
| Section                  | Rule / Formula                                      | Weighting / Threshold                  | Notes / Implication                                                                 |
|--------------------------|-----------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------------------|
| Short Interest           | ≥30% of float                                       | 30%                                    | Confirms skepticism                                                                 |
| Fan Score                | ≤7                                                  | 25%                                    | Low rabid-fan risk                                                                  |
| Fraud / Employee Distress| Class actions, short reports, Glassdoor ≤3.4, layoffs | 20%                                    | Strengthens bear thesis                                                             |
| Buyback Score            | 0 (no active program)                               | 15%                                    | Negative signal for weak-name thesis                                                |
| Acquisition Radar        | Completely clean                                    | 10%                                    | Any credible rumor = instant exit                                                   |

**Put Side (Strong Names)**
| Section                  | Rule / Formula                                      | Weighting / Threshold                  | Notes / Implication                                                                 |
|--------------------------|-----------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------------------|
| Short Interest           | <15% of float                                       | 30%                                    | Low squeeze risk                                                                    |
| Fan Score                | 7–10                                                | 25%                                    | Bullish buy-the-dip support                                                         |
| Positive Fundamentals    | Earnings beats, Glassdoor >3.5                      | 20%                                    | Strengthens bull thesis                                                             |
| Buyback Score            | +1 (active program)                                 | 15%                                    | Positive capital-return signal                                                      |
| Downside-Gap Radar       | Completely clean                                    | 10%                                    | Any credible negative catalyst = instant exit                                       |

### 4. Fan Score Formula
| Section                  | Rule / Formula                                      | Weighting / Threshold                  | Notes / Implication                                                                 |
|--------------------------|-----------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------------------|
| Fan Score                | (40% QuiverQuant Meme Score) + (25% Social volume) + (20% Retail ownership %) + (15% Cult behavior) | 1–10 scale                             | Recalculate weekly; Call side ≤7 = full size; Put side 7–10 = preferred            |

### 5. Buyback Score
| Section                  | Rule / Formula                                      | Weighting / Threshold                  | Notes / Implication                                                                 |
|--------------------------|-----------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------------------|
| Buyback Score (Call side)| 0 if none/minimal; -1 if active                     | 15% (negative for calls)               | No buybacks strengthens weak-name thesis                                            |
| Buyback Score (Put side) | +1 if active; 0 if none/minimal                     | 15% (positive for puts)                | Active buybacks strengthen strong-name thesis                                       |

### 6. Grok Systemic Risk Score (GSRS) – Put Side Only
| Section                  | Rule / Formula                                      | Weighting / Threshold                  | Notes / Implication                                                                 |
|--------------------------|-----------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------------------|
| GSRS                     | 40% VIX +1d change + 20% SKEW + 20% HY OAS vs 5yr avg + 10% MOVE + 10% Equity P/C vs avg | 0–10 scale                             | Recalculate live for puts only                                                      |
| GSRS Actions             | 0–3: full size; 3–5: halve; 5–7: 1% risk; 7–10: pause + hedge | N/A                                    | Protects against systemic crashes                                                   |

### 7. Mean-Reversion Buffer (Put Side Only)
| Section                  | Rule / Formula                                      | Weighting / Threshold                  | Notes / Implication                                                                 |
|--------------------------|-----------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------------------|
| Buffer                   | Strike ≥ 2 × 14-day ATR below price                 | POT ≤35–40%                            | Prevents normal pullbacks from triggering doubles                                   |

### 8. Strategy & Sizing Rules ($1M Account)
| Section                  | Rule / Formula                                      | Weighting / Threshold                  | Notes / Implication                                                                 |
|--------------------------|-----------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------------------|
| Initial Risk per Name    | 5% of account ($50,000 margin)                      | N/A                                    | Aggressive sizing                                                                   |
| Double #1                | At Break #1: double to 15% total risk               | N/A                                    | Only if IV still high                                                               |
| Double #2                | At Break #2: double to 25% total risk max           | N/A                                    | Then mandatory full exit                                                            |
| Portfolio Limit          | 4–8 names; max 40–50% total risk                    | N/A                                    | Sector correlation ≤50%                                                             |
| Cash with 4× Leverage    | Total margin used ÷ 4                               | N/A                                    | Example: $200k margin = $50k cash                                                   |

### 9. Monitoring Radars (Full Definitions)
**Acquisition Radar (Call Side)**: Any credible takeover rumor, 13D/13G filing, PE interest, strategic buyer speculation, analyst M&A commentary = instant exit.  
**Downside-Gap Radar (Put Side)**: Any credible regulatory threat, fraud revelation, major lawsuit, cyber breach, bankruptcy filing, catastrophic earnings miss, large customer loss = instant exit.

### 10. Daily Workflow & Response Requirements
| Step | Action                                              | Notes                                                                 |
|------|-----------------------------------------------------|-----------------------------------------------------------------------|
| 1    | Run fresh screen using only data available at Monday open | No future look-ahead                                                  |
| 2    | Apply all filters, weightings, scores, radars       | GSRS, Fan, Buyback, etc.                                              |
| 3    | Output table + sized orders + alerts                | Include cash requirement and expected daily theta                     |
| 4    | End with “Basket loaded — ready to execute”         | List 2–3 next-step options                                            |

This checklist contains **every rule, formula, and weighting** we developed. Copy the tables above into your spreadsheet for manual use or reference.  

If you need this exported as a CSV, Google Sheet link (hypothetical), or any section expanded further, let me know.  

The intellectual framework you built is now fully documented and ready for your tools.