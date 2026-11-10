---
rule: modern_syntax
---
# Modern ABAP syntax

Statements of old ABAP releases that have a modern form since ABAP 7.40: expressions and built-in functions are
shorter, can be used in operand positions and do not need helper variables. New code uses the modern form; existing
code is changed when it is touched. (MOVE, COMPUTE, ADD, REFRESH, OCCURS, RANGES and other obsolete statements are
reported by `obsolete_statement`.)

| Instead of | Write |
|---|---|
| `READ TABLE itab INTO wa WITH KEY k = v.` | `DATA(wa) = VALUE #( itab[ k = v ] OPTIONAL ).` or `ASSIGN itab[ k = v ] TO FIELD-SYMBOL(<wa>).` |
| `READ TABLE itab TRANSPORTING NO FIELDS WITH KEY k = v.` | `IF line_exists( itab[ k = v ] ).` / `DATA(idx) = line_index( itab[ k = v ] ).` |
| `CONCATENATE a b INTO c SEPARATED BY space.` | `c = |{ a } { b }|.` |
| `CONCATENATE LINES OF itab INTO c SEPARATED BY ','.` | `c = concat_lines_of( table = itab sep = ',' ).` |
| `TRANSLATE s TO UPPER CASE.` | `s = to_upper( s ).` |
| `CONDENSE s.` | `s = condense( s ).` |
| `DESCRIBE TABLE itab LINES n.` | `n = lines( itab ).` |
| `SEARCH s FOR 'x'.` | `FIND 'x' IN s.` / `find( val = s sub = 'x' )` |
| `SHIFT s LEFT DELETING LEADING '0'.` | `s = shift_left( val = s sub = '0' ).` |
| `WRITE date TO text.` | `text = |{ date DATE = USER }|.` |
| `SELECT … ENDSELECT.` | `SELECT … INTO TABLE @DATA(rows).` then `LOOP AT rows …` |
| `FORM … ENDFORM` / `PERFORM` | methods of a local class (`CLASS lcl_… DEFINITION` … `lcl_…=>run( )`) |

Classic programs keep their events (`START-OF-SELECTION`, `AT SELECTION-SCREEN`) and dialog modules (`MODULE …`), and
call methods of local classes from there.
