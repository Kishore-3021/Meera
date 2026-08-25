# Tool and Parameter Validation

Every planner proposal passes through the registry before permissions or execution:

1. Resolve the exact live tool ID.
2. Reject unknown tools.
3. Reject unknown fields, missing required fields, invalid types, and impossible values.
4. Normalize real Windows paths and scalar values.
5. Apply the existing permission policy.
6. Execute only the validated parameters.
7. Record structured success and verification evidence.

Rejected calls are recorded in the execution ledger and sent back to Qwen as compact validator feedback with the relevant live tool list. Repeated invalid or failing calls are bounded and stop rather than becoming fabricated success.
