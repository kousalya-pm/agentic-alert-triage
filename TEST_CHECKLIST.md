# Complete Workflow Test Checklist

## ✅ Build Status
- [x] Production build completes without errors
- [x] No TypeScript/ESLint errors
- [x] All imports resolved correctly

## 🧪 URL Navigation & Routing

### Basic Alert Navigation
- [ ] Load `/alerts/ALT-2026-001` → displays alert in queue + panel
- [ ] Load `/alerts/ALT-2026-002` → displays different alert
- [ ] Click different alert in queue → URL updates to `/alerts/ALT-2026-XXX`

### Incident Navigation (NEW)
- [ ] Load `/alerts/INC-WKSTN-FIN-055` → reconstructs incident, displays in panel
- [ ] Load `/alerts/INC-mchen` → reconstructs incident for different entity
- [ ] Incident displays all constituent alerts + kill chain

### Home Navigation (NEW)
- [ ] Click logo/org name → clears alert, goes to home
- [ ] URL becomes `/` with no alert selected
- [ ] "No alert selected" message displays in triage panel

## 🎯 Workflow Validation Guards

### All 4 Modes - No Alert Selected
- [ ] Standard: displays "No alert selected" message when alert is null
- [ ] Adaptive: displays "No alert selected" message when alert is null
- [ ] Parallel: displays "No alert selected" message when alert is null
- [ ] Chain: displays "No alert selected" message when alert is null

### All 4 Modes - With Alert
- [ ] Standard: renders full UI when alert is present
- [ ] Adaptive: renders full UI when alert is present
- [ ] Parallel: renders full UI when alert is present
- [ ] Chain: renders full UI when alert is present

## ▶️ Triage Execution

### Standard Mode
- [ ] Click "Run AI Triage" or center play button → begins investigation
- [ ] Phases progress: PLANNING → INVESTIGATING → SYNTHESIZING → DONE
- [ ] Run appears in history bar upon completion
- [ ] Can replay run from history

### Adaptive Mode
- [ ] Runs and completes successfully
- [ ] Run appears in history bar
- [ ] Dynamic steps are visible if any were added

### Parallel Mode
- [ ] Runs 4 specialist agents in parallel
- [ ] Orchestrator synthesizes results
- [ ] Run appears in history bar
- [ ] All agent states are preserved in run history

### Chain Mode
- [ ] Tier 1 quick scan completes
- [ ] Tier 2 investigation triggers on escalation
- [ ] Tier 3 synthesis (if applicable) runs
- [ ] All tier results in history
- [ ] Run history shows full chain progression

## 💾 Run History Persistence

### Within Same Alert
- [ ] Run Standard → check history bar shows run
- [ ] Run Adaptive → history shows both Standard and Adaptive runs
- [ ] Click history button → loads prior run, displays results
- [ ] Click "New Run" → starts fresh investigation

### Across Alerts
- [ ] Run Standard on Alert A
- [ ] Switch to Alert B
- [ ] Switch back to Alert A
- [ ] **Critical**: History bar still shows Alert A's Standard run (was lost before fix)

### Across Workflows
- [ ] Run Standard on Alert A
- [ ] Switch to Adaptive mode
- [ ] **Critical**: History bar still shows Alert A's Standard run (was lost before fix)

### Navigation Away & Back
- [ ] Start Standard investigation (mid-way)
- [ ] Switch to different alert
- [ ] Switch back to original alert
- [ ] **Critical**: Intermediate state should be saved (auto-save hook)

## 🔗 Incident-Specific Tests

### Incident Grouping
- [ ] Alert queue shows incidents as cards with multiple alerts
- [ ] Individual alerts show with single alert ID

### Incident Click
- [ ] Click incident card → loads incident into panel
- [ ] URL changes to `/alerts/INC-{entity_id}`
- [ ] Kill chain strip shows incident's attack progression
- [ ] All constituent alerts accessible in expanded view

### Incident Triage
- [ ] Run Standard on incident → investigation plan covers all entities
- [ ] Run Adaptive on incident → can add dynamic steps
- [ ] Run Parallel on incident → all agents get full incident context
- [ ] Run Chain on incident → investigation scope covers full incident

### Incident History
- [ ] Run incident triage in one mode
- [ ] Switch to different incident
- [ ] Switch back → history still there
- [ ] Switch to different mode → history for first mode still there

## ⚠️ Edge Cases

### No Data
- [ ] Clear all alerts from localStorage (dev tools)
- [ ] Load `/alerts/ALT-2026-001` → graceful error handling

### Invalid URL
- [ ] Load `/alerts/INVALID-ID` → no alert selected, friendly message
- [ ] Load `/alerts/` (no ID) → home page

### Concurrent Operations
- [ ] Start Standard triage
- [ ] Click different alert while running → mode locks correctly
- [ ] Cannot click other modes while running

## 📊 Overall Status

**Pre-Refactor Issues Found:**
- INC-* URLs didn't work (fixed)
- No alert validation in workflows (fixed)
- Duplicate auto-save effects (refactored)

**Post-Refactor Verification:**
- All 4 workflows have validation guards
- Shared hook reduces code duplication
- Run history persists across navigation
- Direct URL navigation works for both alerts and incidents

