REPORT zcflight_adobe.

* Prints the Adobe form ZCFL_FLIGHT_CARD (src/zcfl_flight_card.xdp) the classic way: FP_JOB_OPEN,
* FP_FUNCTION_MODULE_NAME, the form's generated function module (interface parameter IS_FLIGHT), FP_JOB_CLOSE.

PARAMETERS p_carr TYPE zcfl_carrier DEFAULT 'LH'.
PARAMETERS p_prev AS CHECKBOX DEFAULT 'X'.

START-OF-SELECTION.
  SELECT SINGLE * FROM zcflight_a WHERE carrier_id = @p_carr INTO @DATA(ls_flight).

  DATA ls_outputparams TYPE sfpoutputparams.
  DATA ls_docparams TYPE sfpdocparams.
  DATA ls_formoutput TYPE fpformoutput.
  DATA lv_fm_name TYPE rs38l_fnam.

  ls_outputparams-getpdf = p_prev.
  ls_outputparams-covtitle = |Flight card { p_carr }|.
  CALL FUNCTION 'FP_JOB_OPEN'
    CHANGING
      ie_outputparams = ls_outputparams
    EXCEPTIONS
      OTHERS          = 1.
  CALL FUNCTION 'FP_FUNCTION_MODULE_NAME'
    EXPORTING
      i_name     = 'ZCFL_FLIGHT_CARD'
    IMPORTING
      e_funcname = lv_fm_name.
  ls_docparams-langu = 'E'.
  CALL FUNCTION lv_fm_name
    EXPORTING
      /1bcdwb/docparams  = ls_docparams
      is_flight          = ls_flight
    IMPORTING
      /1bcdwb/formoutput = ls_formoutput
    EXCEPTIONS
      OTHERS             = 1.
  CALL FUNCTION 'FP_JOB_CLOSE'
    EXCEPTIONS
      OTHERS = 1.
  WRITE: / |Function module { lv_fm_name }|.
  IF p_prev = abap_true.
    WRITE: / |PDF { ls_formoutput-pages } page(s), { xstrlen( ls_formoutput-pdf ) } bytes|.
  ELSE.
    WRITE: / 'Sent to the output queue'.
  ENDIF.
