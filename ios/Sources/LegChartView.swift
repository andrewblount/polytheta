import Charts
import SwiftUI

// One leg against its strike: the underlying's regular-session path with the
// strike sold drawn as the alert line, the entry price and the breakeven
// (strike ± credit), the numbers that describe the path, and — for a leg that
// expired in the money — the post-mortem. Used inline on the current basket
// and on every archived basket.

func priceText(_ v: Double?) -> String { v.map { String(format: "$%.2f", $0) } ?? "—" }
func pctText(_ v: Double?, _ digits: Int = 1) -> String { v.map { String(format: "%.\(digits)f%%", $0) } ?? "—" }
func etTime(_ iso: String?) -> String {
    guard let iso, let d = PricePoint.parser.date(from: iso) ?? PricePoint.fallback.date(from: iso) else { return "—" }
    let f = DateFormatter(); f.timeZone = TimeZone(identifier: "America/New_York"); f.dateFormat = "MMM d, h:mm a"
    return f.string(from: d)
}

struct LegPathChart: View {
    let leg: LegPath
    var height: CGFloat = 170

    private var through: Bool {
        leg.side == "call" ? leg.points.contains { ($0.h ?? $0.p) > leg.lines.strike } : leg.points.contains { ($0.l ?? $0.p) < leg.lines.strike }
    }

    var body: some View {
        if leg.points.isEmpty {
            Text("Price history unavailable for this leg.").font(.caption).foregroundStyle(.secondary).frame(height: 60)
        } else {
            let values = leg.points.map(\.p) + [leg.lines.strike, leg.lines.entry, leg.lines.breakeven]
            let lo = values.min() ?? 0, hi = values.max() ?? 1
            let pad = max((hi - lo) * 0.08, 0.05)
            Chart {
                ForEach(Array(leg.points.enumerated()), id: \.offset) { i, pt in
                    LineMark(x: .value("Bar", i), y: .value("Price", pt.p))
                        .foregroundStyle(Color.accentColor)
                        .interpolationMethod(.monotone)
                }
                RuleMark(y: .value("Strike", leg.lines.strike))
                    .foregroundStyle(through ? Color.red : Color.orange)
                    .lineStyle(StrokeStyle(lineWidth: 2))
                    .annotation(position: .top, alignment: .trailing) {
                        Text("Strike \(leg.lines.strike, specifier: "%.2f")").font(.caption2.weight(.semibold)).foregroundStyle(through ? .red : .orange)
                    }
                RuleMark(y: .value("Breakeven", leg.lines.breakeven))
                    .foregroundStyle(Color.red.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .annotation(position: .bottom, alignment: .trailing) {
                        Text("B/E \(leg.lines.breakeven, specifier: "%.2f")").font(.caption2).foregroundStyle(.red.opacity(0.8))
                    }
                RuleMark(y: .value("Entry", leg.lines.entry))
                    .foregroundStyle(Color.secondary.opacity(0.7))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [6, 3]))
                    .annotation(position: .bottom, alignment: .leading) {
                        Text("Entry \(leg.lines.entry, specifier: "%.2f")").font(.caption2).foregroundStyle(.secondary)
                    }
            }
            .chartYScale(domain: (lo - pad)...(hi + pad))
            .chartXAxis {
                AxisMarks(values: sessionStarts()) { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let i = value.as(Int.self), i < leg.points.count { Text(sessionLabel(leg.points[i])).font(.caption2) }
                    }
                }
            }
            .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) }
            .frame(height: height)
        }
    }

    // First bar of each session, so the x axis reads as trading days.
    private func sessionStarts() -> [Int] {
        var out: [Int] = []
        var last = ""
        for (i, pt) in leg.points.enumerated() {
            let d = sessionLabel(pt)
            if d != last { out.append(i); last = d }
        }
        return out
    }

    private func sessionLabel(_ pt: PricePoint) -> String {
        let f = DateFormatter(); f.timeZone = TimeZone(identifier: "America/New_York"); f.dateFormat = "M/d"
        return f.string(from: pt.date)
    }
}

struct LegOutcomeBadge: View {
    let outcome: String
    var body: some View {
        let (text, color): (String, Color) = switch outcome {
        case "otm": ("Expired worthless", .green)
        case "itm": ("Expired ITM", .red)
        case "exited": ("Exited early", .orange)
        default: ("Open", .secondary)
        }
        Text(text).font(.caption2.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.15)).foregroundStyle(color).clipShape(Capsule())
    }
}

// The chart plus its metrics and the post-mortem link, for a basket screen row.
struct LegPathCard: View {
    let leg: LegPath
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LegPathChart(leg: leg)
            let a = leg.analysis
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], spacing: 6) {
                metric(a.outcome == "open" ? "Last" : a.outcome == "exited" ? "Exit price" : "At expiry",
                       priceText(a.outcome == "open" ? a.lastPrice : (a.expiryPrice ?? a.lastPrice)),
                       color: a.expiryPrice != nil ? ((a.intrinsicAtExpiry ?? 0) > 0 ? .red : .green) : .primary)
                metric("Move", pctText(a.movePct, 2))
                metric("Cushion at entry", a.cushionAtr.map { String(format: "%.1f%% · %.1f× ATR", a.cushionPct, $0) } ?? pctText(a.cushionPct))
                metric("Closest to strike", a.closestPrice.map { "\(priceText($0)) (\(pctText(a.closestPct, 0)))" } ?? "—", color: (a.closestPct ?? 0) >= 100 ? .red : .primary)
                metric("First through strike", etTime(a.firstBreachAt))
                metric("Credit kept", pctText(a.creditCapturePct))
            }
            if let pm = a.postMortem {
                NavigationLink {
                    PostMortemView(leg: leg, postMortem: pm)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("Post-mortem", systemImage: "magnifyingglass").font(.caption.weight(.semibold)).foregroundStyle(.red)
                        Text(pm.summary).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    func metric(_ label: String, _ value: String, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption.weight(.medium)).foregroundStyle(color)
        }
    }
}

// What went wrong on a leg that expired in the money, and what would have
// kept it out of the money.
struct PostMortemView: View {
    let leg: LegPath
    let postMortem: PostMortem
    var body: some View {
        List {
            Section {
                LegPathChart(leg: leg, height: 200)
                Text(postMortem.summary).font(.subheadline.weight(.medium))
            } header: {
                Text("\(leg.ticker) \(leg.side) \(leg.strike, specifier: "%.2f") · expired in the money")
            }
            Section("What happened") {
                ForEach(Array(postMortem.findings.enumerated()), id: \.offset) { _, f in
                    Text(f).font(.footnote)
                }
            }
            Section {
                ForEach(postMortem.alternatives) { alt in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(alt.label).font(.subheadline.weight(.semibold))
                            Spacer()
                            if let pnl = alt.pnl {
                                Text(money(pnl)).font(.subheadline.weight(.bold)).foregroundStyle(pnl >= 0 ? .green : .red)
                            }
                        }
                        Text(alt.detail).font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            } header: {
                Text("What would have kept it out of the money")
            } footer: {
                Text("Where a figure is shown it is the leg's modeled result under that alternative at the published contracts. Strike alternatives change the credit as well, so no figure is given.")
            }
        }
        .navigationTitle("Post-mortem")
    }
}
