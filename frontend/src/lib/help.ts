/**
 * Plain-language explanations shown in (i) tooltips across the tool, so a new founder can
 * learn it while using it. Examples follow the PDF (Sony / Kapil Sharma, CMS A, Ananya & Kabir).
 */
export const HELP = {
  // ---- Owners & deals --------------------------------------------------------------------
  owner:
    "Who the content comes from. Licensor = a big rights holder like Sony; Vendor = another studio or supplier; Owned = Taggify's own content.",
  dealType:
    "How Taggify pays for the content. Fixed fee: one licence fee (Sony ₹50L). Revenue share: the owner gets a % of what the content earns. Minimum guarantee + share: an advance that is recouped against the owner's share. Owned IP: no fee.",
  licenceFee: "The total price of the licence, e.g. ₹50,00,000 for Kapil Sharma. Pay it in installments under the Payments tab.",
  minimumGuarantee:
    "Paid to the owner up front and recouped against their revenue share — only the share above it is paid extra.",
  revenueShare: "The owner's % of the gross revenue their content earns.",
  dealStatus: "Draft = not signed yet. Active = signed and in force (it shows as Upcoming or Expired by its dates). Terminated = ended early.",
  term: "The dates the licence is valid. Nothing may be published before the start or after the end.",
  episodeScope:
    "Which episodes are licensed. All, a range (e.g. 101–180), or by season. Publishing an episode outside this is blocked by the rights check.",
  territory: "Countries where the content may be shown. Worldwide unless the contract limits it.",
  slots:
    "How many channels/pages the contract allows (Sony: 10 YouTube + 10 Facebook). Each becomes a slot (YT-01…); a channel sits in a slot.",
  slotStatus:
    "Empty: no channel yet. Reserved: kept for a channel. Pending whitelist: channel added, waiting for the owner's approval. Active: approved — content may go live.",
  noticePeriod:
    "Days before the licence ends by which you must tell the owner whether you renew. The dashboard warns you 30 days ahead.",
  exclusivity: "Exclusive = only Taggify may use this content on these platforms. Non-exclusive = the owner may license it to others too.",
  rightsCheck:
    "Before uploading a clip, check here: is the episode licensed, is the date inside the term, is the territory allowed, and does the channel hold an approved slot? (PDF slide 4)",
  episodes: "Title and details of each licensed episode. Add one by one, or import a CSV for many.",
  documents: "Keep the signed contract, annexures and approval emails with the deal.",

  // ---- Payments & recovery ---------------------------------------------------------------
  installments:
    "The payment plan to the owner, e.g. ₹20L on signing + ₹15L in month 2 + ₹15L in month 4. Paying one lowers what is still payable — it never adds to the rights cost.",
  stillPayable: "Total of the installments not paid yet.",
  recovery:
    "How much of the rights cost the deal has earned back: (gross − CMS fee − incentives − expenses) ÷ rights cost. 64% means ₹32L of ₹50L is back. (PDF slide 11)",
  netContribution: "What the deal has earned after CMS fees, incentives, expenses and the owner's share — before the rights cost.",
  expenses: "Costs charged to this deal, e.g. editing or promotion. They reduce its net contribution.",

  // ---- CMS & finance ---------------------------------------------------------------------
  cms:
    "A CMS collects YouTube earnings for its channels and pays Taggify after keeping its commission. Facebook pages can have a portfolio partner the same way.",
  feeTiers:
    "The CMS commission slabs. The rate depends on the month's total gross of ALL that CMS's channels. CMS A: 20% below $20,000, 15% from $20,000.",
  tierType:
    "Whole: the reached slab's rate applies to the whole month ($25,000 × 15% = $3,750). Marginal: each band at its own rate, like tax slabs ($20,000 × 20% + $5,000 × 15% = $4,750).",
  grossRevenue: "What the platforms reported the channels earned, before anything is deducted.",
  cmsCommission: "The CMS's fee, from its fee tiers, on the month's total gross.",
  netReceivable: "Gross − CMS commission: what the CMS should pay Taggify for the month.",
  cashReceived: "Money that actually reached the bank from the CMS. Not the same as what YouTube reported.",
  outstanding: "Net receivable − cash received ± adjustments: what the CMS still owes. (PDF slide 10)",
  statement: "The CMS's own monthly statement. Enter its numbers here to spot differences with ours.",
  variance: "Statement net minus our calculated net. Not zero means the CMS calculated differently — check before closing the month.",
  adjustment: "A correction to what the CMS owes: tax withheld, a chargeback, a late platform revision. Negative reduces what they owe.",
  fxRate: "The month's exchange rate used to convert USD (or AED) earnings into rupees.",
  receiptCurrency:
    "Enter what the CMS paid in its currency and what the bank credited in rupees. The month's rate decides how much of the balance is cleared; any difference is FX gain or loss.",
  fxDifference: "Bank credit minus the receipt at the month's rate. Positive = gain, negative = loss. It does not change what the CMS owes.",

  // ---- People & incentives ---------------------------------------------------------------
  role: "Founders define roles and what each may do: manage YouTube channels, manage Facebook pages, lead a team.",
  team: "A group of people under one team lead. The lead earns a % on the team's channels.",
  effectiveDate:
    "The date the change takes effect. Past months keep their old assignment, so earlier incentives never change silently.",
  incentiveRate:
    "% of the channel's GROSS revenue, before the CMS fee. Ananya (manager) 1% of $1,000 = $10; Kabir (her team lead) 0.5% = $5. (PDF slide 13)",
  fixedPay: "Monthly salary, for reference. Incentives are calculated separately.",
  manager: "The person responsible for this channel. Only people whose role can manage this platform are listed.",
  externalId: "The platform's own ID: YouTube channel ID (UC…) or Facebook page ID. Revenue imports match on it.",
  monthClose:
    "Locks a finished month: revenue, FX and fee tiers can no longer change. Later corrections go in as adjustments. (PDF slide 16)",
  incentiveStatus:
    "Preview = live calculation. Draft = saved. Approved = frozen for payout. Locked = the month is closed.",

  // ---- Dashboard -------------------------------------------------------------------------
  dashGross: "All channels' gross revenue for the month, in rupees.",
  dashNet: "Gross minus every CMS's commission.",
  dashCash: "What reached the bank from CMS partners for this month.",
  dashRecovery: "Across all fixed-fee and guarantee deals: net contribution so far ÷ rights cost.",
} as const;

export type HelpKey = keyof typeof HELP;
