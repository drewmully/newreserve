# L11: approved single-touch attribution

Implements one classification and weight 1 for each eligible order, including
explicit unattributed and not-applicable renewal buckets. The selected last
eligible non-direct session can differ from checkout. Actual observed direct
fallback is explicit policy, not a guess from absent UTMs. Future/out-of-window
sessions and cross-publication evidence are excluded.

Lookback, model, direct fallback and approval are required parameters; the
workbook's proposed 30 days is not silently treated as finalized policy.
Incomplete identity/lookback/grace yields pending output. Qualified campaign
mapping needs evidence. First-customer credits join only the certified first
eligible order, never each repeat purchase.

Before activation approve the model and mapping inventory, bind independently
verified completeness evidence, reconcile unassigned share and verify conversion-
date purchase-value ROAS against same-date approved spend. This is first-party
attribution, not a reproduction of native ad-platform ROAS.
