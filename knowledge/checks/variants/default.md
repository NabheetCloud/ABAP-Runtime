---
name: DEFAULT
title: Default check variant
description: What RAP Studio checks in every app (like an ATC check variant). Errors must be fixed, warnings should be, infos are suggestions.
---

# Default check variant

The platform reads this file: each heading is a category, each table row a check with its severity (`error`,
`warning`, `info` or `off`) and optional settings (JSON). An app can change rows in its own `checks.md` with the same
format. The checks come from [abaplint](https://abaplint.org) (`abaplint` rules) and RAP Studio (`rap` rules); the
explanation of every check is in `knowledge/checks/rules/` or, for abaplint rules, in abaplint's documentation, and
for many checks in the [abapOpenChecks](https://docs.abapopenchecks.org) descriptions in `knowledge/abapopenchecks/`.

## Syntax and correctness

| Check | Severity | Settings |
|---|---|---|
| parser_error | error | |
| check_syntax | error | |
| implement_methods | error | |
| method_implemented_twice | error | |
| begin_end_names | error | |
| invalid_table_index | error | |
| cds_parser_error | error | |
| bdef_parser_error | error | |
| unreachable_code | warning | |
| uncaught_exception | warning | |
| check_subrc | info | |
| identical_conditions | warning | |
| sy_modification | warning | |
| when_others_last | warning | |
| superclass_final | error | |

## ABAP Cloud readiness

| Check | Severity | Settings |
|---|---|---|
| released_api | warning | |
| sy_read_restriction | warning | |
| cds_legacy_view | warning | |

## Modern ABAP syntax

Old statements are reported with their modern form (the explanation of `modern_syntax` lists them): write new code with
expressions, built-in functions and classes from the start.

| Check | Severity | Settings |
|---|---|---|
| obsolete_statement | warning | |
| modern_syntax | warning | |
| use_new | warning | |
| avoid_use | warning | {"define": true, "statics": false, "defaultKey": true, "break": true, "testSeams": false, "describeLines": false, "exportToMemory": true, "exportToDatabase": true} |
| form_tables_obsolete | warning | |
| type_form_parameters | warning | |
| no_external_form_calls | warning | |
| function_module_recommendations | warning | |
| prefer_inline | info | |
| prefer_corresponding | info | |
| prefer_insert_into_table | info | |
| use_bool_expression | info | |
| exit_or_check | info | |
| no_macros | info | |
| superfluous_value | info | |
| redundant_conversion | info | |
| cds_comment_style | info | |

## Security

| Check | Severity | Settings |
|---|---|---|
| dangerous_statement | error | |
| call_transaction_authority_check | warning | |
| no_dynamic_stuff | info | |

## Performance

| Check | Severity | Settings |
|---|---|---|
| db_operation_in_loop | warning | |
| select_performance | warning | |
| delete_index_in_loop | warning | |
| sort_empty_key | warning | |
| slow_parameter_passing | info | |

## Robustness

| Check | Severity | Settings |
|---|---|---|
| unused_variables | warning | |
| unused_types | info | |
| unused_methods | info | |
| empty_structure | info | |
| identical_contents | info | |
| constant_condition | warning | |
| copy_of_initial_variable | warning | |
| try_without_catch | warning | |
| catch_and_raise | info | |
| try_cast_empty_catch | info | |
| empty_statement | info | |
| subrc_after_assign | info | |
| is_assigned_in_loop | warning | |
| clear_exporting_parameters | info | |

## Clean ABAP

| Check | Severity | Settings |
|---|---|---|
| prefer_xsdbool | info | |
| use_line_exists | info | |
| prefer_is_not | info | |
| functional_writing | info | |
| omit_receiving | info | |
| exporting | info | |
| prefer_returning_to_exporting | info | |
| no_yoda_conditions | info | |
| prefer_raise_exception_new | info | |
| if_in_if | info | |
| else_after_all_returns | info | |
| unnecessary_return | info | |
| nesting | warning | {"depth": 5} |
| method_length | info | {"statements": 100, "ignoreTestClasses": true} |
| cyclomatic_complexity | info | {"max": 20} |
| prefer_string_template | info | |
| use_class_based_exceptions | info | |
