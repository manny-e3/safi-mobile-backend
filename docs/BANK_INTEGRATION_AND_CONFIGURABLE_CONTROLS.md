# SAFI Autonomous Protection Engine
## Partner Bank Integration & Configurable Controls Guide

**Audience:** Bank Leadership, Heads of Retail & Digital Banking, Product Teams, Risk & Compliance Officers, and Technical Integration Leads  
**Version:** 2.4 (Executive & Operational Edition)  
**Classification:** Strategic Banking Middleware & Liquidity Governance  

---

## 1. What is SAFI?

**SAFI** is an intelligent financial governance layer that integrates into a bank’s existing systems to help bank customers manage their money responsibly while helping the bank **grow and retain customer deposits**.

### The Core Problem in Traditional Banking
In standard banking, if a customer has ₦500,000 in their account, they can spend all ₦500,000 on day one. Within the first two weeks of salary payment, most discretionary income is depleted. This leads to:
- Rapid deposit runoff (CASA leakage) for the bank.
- Increased customer financial distress before the next payday.
- Higher risk of consumer credit defaults.

### The SAFI Solution
SAFI divides the customer's balance into two clear, automated buckets:
1. **The Protected Reserve:** A sacrosanct floor (e.g. ₦150,000) that stays locked in the bank as safe savings.
2. **The Spend Pool:** The remaining amount (₦350,000) partitioned over a set cycle (e.g. 30 days) with real-time spend pacing and daily safe limits.

```
       CUSTOMER GROSS BALANCE (₦500,000)
                    │
     ┌──────────────┴──────────────┐
     ▼                             ▼
PROTECTED RESERVE             SPEND POOL
  (₦150,000)                  (₦350,000)
• Untouchable savings       • For daily living expenses
• Retained by the bank      • Governed by cycle rules (30 days)
• Grows over time           • Safe daily spend: ~₦11,600 / day
```

---

## 2. Commercial Benefits for the Integrating Bank

| Strategic Value | What It Delivers to Your Bank |
| :--- | :--- |
| **+18% to +26% Deposit Retention** | Keeps low-cost deposits (CASA) sitting in the bank throughout the month rather than draining in the first 10 days. |
| **Higher Customer Loyalty** | Customers view your bank as a partner helping them save and build wealth, increasing account stickiness. |
| **Lower Risk on Loans & Overdrafts** | The bank gets real-time insights into customer cash-flow health, reducing defaults on consumer credit. |
| **Regulatory Alignment** | Fully compliant with Central Bank of Nigeria (CBN) guidelines for safe fund segregation and customer protection. |

---

## 3. How the Integration Works (In Simple Terms)

SAFI sits seamlessly between your **Banking Channels** (Mobile App, Debit Cards, POS, Web Transfers) and your **Core Banking System (CBS)**.

```
Customer swipes Card or sends Transfer
                 │
                 ▼
       Bank Payment Gateway / CBS
                 │
                 ▼
        Does SAFI approve the spend?
                 │
        ┌────────┴────────┐
        ▼                 ▼
     [ YES ]           [ NO ]
        │                 │
  Transaction       Transaction Declined
   Completes         (Reserve is protected;
                     customer notified on phone)
```

### The 3 Easy Integration Options for Banks

Banks choose the model that best fits their technology stack:

1. **Option 1: Mobile App & Transfer Check (Recommended First Step)**
   - When a customer makes a transfer or bill payment on your mobile app or internet banking, the bank makes a quick, lightweight check to SAFI.
   - If the payment would breach their protected savings, the app politely notifies the user before processing.
   - *Time to integrate: 1 to 2 weeks.*

2. **Option 2: Card & POS Terminal Interception (Full Protection)**
   - When a customer swipes their debit card at a shop or ATM, your card switch (e.g. Postilion, Interswitch) checks with SAFI.
   - If their spend pool is empty, the card declines with standard bank response code *"Insufficient Funds / Protected Reserve"*.
   - *Takes under 5 milliseconds — your customers will experience zero delay.*

3. **Option 3: Smart Financial Coach (Advisory & Analytics)**
   - If the bank prefers not to decline cards, SAFI can run in advisory mode.
   - It tracks customer spend habits, calculates daily safe spend, and delivers push notifications (e.g., *"You've used 70% of your spend pool with 15 days left"*).

---

## 4. Real-World Example: How It Works in Practice

Let’s see what happens with a customer named **Alexander**:
- **Monthly Income:** ₦500,000
- **Protected Reserve:** ₦150,000 (Locked savings)
- **Spend Pool for the Month:** ₦350,000 (₦11,600 / day)
- **Chosen Protection:** `Hard Decline`

### Scenario A: Normal Daily Spending (Approved)
* Alexander buys groceries for ₦15,000 at the supermarket.
* His balance drops from ₦500,000 to ₦485,000.
* Since ₦485,000 is still well above his ₦150,000 protected reserve, the transaction is **approved instantly**.

### Scenario B: Attempting to Eat into Savings (Declined)
* Later in the month, Alexander has only ₦160,000 left in his account (only ₦10,000 left in his spend pool).
* He tries to buy an expensive gadget for ₦50,000.
* Doing so would bring his balance down to ₦110,000—which would **breach his ₦150,000 reserve**.
* **Outcome:** The transaction is **declined**.
* Alexander receives an instant push notification on his phone:  
  *“Transaction declined. Your reserve of ₦150,000 is safely protected by SAFI.”*

---

## 5. All Configurable Controls (The Complete Catalog)

SAFI provides full control to both the **Bank’s Management** and the **End Customer**.

```
                           ALL CONFIGURABLE CONTROLS
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
   1. BANK-LEVEL CONTROLS                                2. CUSTOMER-LEVEL CONTROLS
 (Set by Bank Risk & Product Team)                     (Set by Customer in Mobile App)
• Macro Governance Mode (Flexible vs Strict)          • Monthly Income Allocation
• Permitted Card Behaviours (Global Whitelist)        • Protected Reserve Floor (Savings)
• Active Mode Whitelists                              • Cycle Duration (Monthly, Weekly, Custom)
• Institutional Rules (High-Volume Alerts, Payroll)   • Card Action (Hard Decline, Buffer, Auto-Cover)
• Compliance Reporting & Automated Webhooks           • Safety Pause (Max 3/year, 14-day watchdog)
• Full Audit Trail of all modifications               • Emergency One-Off Override
```

---

### 5.1 Bank-Level Institutional Controls (Admin & Risk)

These controls allow the bank's Head of Retail, Chief Risk Officer, and Product Managers to set the ground rules across the entire bank.

| Control | Description | Bank Options |
| :--- | :--- | :--- |
| **Global Governance Mode** | Sets the bank’s overall risk posture. | • **Flexible:** Spend pacing is advisory; auto-cover and cushions are permitted.<br>• **Strict:** Enforces daily safe-spend limits; prevents overspending. |
| **Allowed Behaviours Whitelist** | Decides which options retail customers are allowed to pick. | The bank can allow all three options (`Hard Decline`, `Buffer`, `Auto Cover`) or restrict customers only to `Hard Decline` to enforce strict savings. |
| **Institutional Rules Engine** | Pre-set policies that apply automatically to customer segments. | • **Standard 30-Day Cycle:** Standard retail rule.<br>• **Salary-Linked Trigger:** Automatically restarts the cycle whenever a salary arrives.<br>• **High-Volume Alert:** Automatically flags transactions above ₦5,000,000 for review. |
| **Compliance Export Webhook** | Automatically shares audit and compliance summaries with bank regulators or partner institutions. | Set target URL and frequency (e.g. *Monthly*, *Weekly*). |
| **Institutional Audit Trail** | A tamper-proof log of every action taken by bank administrators. | Automatically logs actor, action, and timestamp. |

---

### 5.2 Customer & Account-Level Controls (In the Mobile App)

These controls are configured by the customer inside the bank's mobile app or internet banking portal:

| Customer Control | What It Does | Example / User Choice |
| :--- | :--- | :--- |
| **Income Base** | The expected money inflow for the period. | ₦500,000 per month |
| **Protected Reserve Floor** | The minimum untouchable savings amount that cannot be spent. | ₦150,000 |
| **Spend Allocation** | The spending money calculated automatically. | $\text{Income} - \text{Reserve} = ₦350,000$ |
| **Cycle Frequency** | How often the budget cycle resets. | • **Monthly** (Standard)<br>• **Bi-weekly** (Every 2 weeks)<br>• **Weekly**<br>• **Custom Days** (e.g. 15 or 45 days) |
| **Card Behaviour** | What happens when the spend pool runs out. | • **Hard Decline:** Block the card/transfer.<br>• **Buffer:** Use a small emergency cushion first.<br>• **Auto Cover:** Let it pass, but log an alert. |
| **Buffer Cushion** | A small secondary backup amount for minor emergencies. | e.g. ₦20,000 cushion |
| **Rollover Preference** | What happens to unspent money at the end of the month. | • **Return to Reserve:** Automatically locks savings into the protected vault.<br>• **Rollover:** Adds unspent money to next month's spending pool. |

---

### 5.3 What Happens When Money Runs Out? (Card Actions Explained)

When a customer tries to spend past their allowed limit, SAFI responds according to their selected choice:

1. **Option 1: Hard Decline (Maximum Protection)**
   - The card or transfer is blocked immediately.
   - The customer's savings remain 100% untouched.
   - A friendly push notification explains why the card was declined.

2. **Option 2: Buffer Cushion (Gentle Protection)**
   - The customer sets a small backup cushion (e.g. ₦20,000).
   - If they exceed their limit by ₦5,000, SAFI allows it and reduces the cushion to ₦15,000.
   - Once the cushion reaches ₦0, SAFI automatically switches to **Hard Decline** to protect the main reserve.

3. **Option 3: Auto Cover (Advisory Protection)**
   - The transaction goes through without interruption.
   - SAFI marks the account with an alert, temporarily reduces their compliance score, and warns them that their savings reserve has been breached.

---

### 5.4 Safety Valves (Customer Flexibility Without Abuse)

To ensure customers never feel trapped in an emergency, SAFI includes built-in safety features:

1. **Discretionary Pause (With 14-Day Safety Watchdog)**
   - A customer can pause SAFI protection anytime if they have unusual travel or temporary expenses.
   - **Protection Limit:** A customer can only pause up to **3 times per calendar year**.
   - **The 14-Day Watchdog:** If an account is left paused for 14 consecutive days, SAFI **automatically turns protection back on** so customers don't abandon their financial habits.

2. **Emergency Manual Override**
   - In a genuine emergency (e.g. hospital bill), the customer or bank officer can enter a one-time override with a reason.
   - The transaction goes through immediately, and the reason is recorded for compliance.

3. **USSD Emergency Exemption**
   - Basic USSD phone transfers automatically bypass behavioural limits to ensure access to critical funds even without internet or smartphones.

---

## 6. How the Bank and Customer Monitor Health

### 1. Daily Safe Spend Pacing
SAFI calculates the customer's safe spending rate in real time:
$$\text{Safe Daily Spend} = \frac{\text{Remaining Spend Pool}}{\text{Days Left in the Month}}$$
If the customer has ₦140,000 left with 14 days to go, their dashboard displays:  
**“You have ₦10,000 / day safe to spend.”**

### 2. Spend Pace Indicators
- **Doing Very Well:** Spending slower than planned (great savings trajectory).
- **On Track:** Spending matches the calendar days perfectly.
- **Warning:** Spending too fast; will run out of money before payday.

### 3. Financial Discipline Score (0 to 100)
A credit-bureau-style score that rewards good habits:
- Customers start with **100 points**.
- Deducts 15 points if they trigger an override or breach savings.
- Awards **+20 bonus points** at the end of each clean cycle.
- Scores above 85 earn the prestigious **`Protected`** badge.

---

## 7. Performance & Reliability Guarantees for the Bank

Banks process millions of transactions per day, so SAFI is engineered to enterprise standards:

```
               100ms INDUSTRY STANDARD TIME LIMIT FOR CARDS
+──────────────────────────────────────────────────────────────────────────+
│ Network: 14ms │ SAFI Decision: 4ms │ Bank Settlement: 22ms │ Buffer: 60ms │
+──────────────────────────────────────────────────────────────────────────+
```

- **Ultra-Fast (Under 5ms):** SAFI makes decisions in just **4 milliseconds**—customers will never feel lag at an ATM or POS machine.
- **Fail-Open Safety Switch:** If SAFI ever experiences network issues or takes longer than 25ms to respond, it automatically **fails open**. Legitimate bank cardholders will **never be stranded** at a checkout counter.
- **Zero Card Data Stored (PCI-DSS Safe):** SAFI only uses 11-digit NUBAN account numbers. Card numbers (PAN) and CVVs are never processed or stored by SAFI.
- **Central Bank of Nigeria (CBN) Aligned:** Complies with CBN guidelines for digital deposit protection, audit logging, and data privacy.

---

## 8. Summary Checklist for Partner Banks

Integrating your bank with SAFI is straightforward and can be accomplished in stages:

- [x] **Stage 1: Presentation & Alignment (Week 1)**  
  Review commercial deposit retention projections and select default bank rules.
- [x] **Stage 2: Sandbox Testing (Weeks 2–3)**  
  Bank developers connect to the SAFI test sandbox and verify sample transfers and card checks.
- [x] **Stage 3: Mobile App Integration (Weeks 3–4)**  
  Embed the customer dashboard (savings reserve, daily safe spend, pause button) into your mobile app.
- [x] **Stage 4: Pilot Launch (Week 5)**  
  Roll out to a selected pilot group (e.g. staff or premium salary account holders).
- [x] **Stage 5: Full Commercial Launch (Week 6)**  
  Open to all retail banking customers with automated compliance reporting.

---

### Questions & Bank Integration Contacts
For sandbox credentials, live demos, or technical support, please contact:  
**SAFI Institutional Integration Team**  
Email: `integrations@meridian.bank` | Web: `https://meridian.bank/safi`
