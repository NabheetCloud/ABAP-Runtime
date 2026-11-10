FUNCTION z_typ_add.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_A) TYPE  I
*"     VALUE(IV_B) TYPE  I DEFAULT 5
*"  EXPORTING
*"     VALUE(EV_SUM) TYPE  I
*"  TABLES
*"      T_LOG STRUCTURE  STRING OPTIONAL
*"  EXCEPTIONS
*"      NEGATIVE
*"----------------------------------------------------------------------
  IF iv_a < 0.
    RAISE negative.
  ENDIF.
  ev_sum = iv_a.
  PERFORM add_up USING iv_b CHANGING ev_sum.
  calls = calls + 1.
  APPEND |{ iv_a }+{ iv_b }| TO t_log.
ENDFUNCTION.
