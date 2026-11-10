REPORT zpo_print.

* Prints purchase order ZF_PO_PRINT (Adobe XDP layout): FP_JOB_OPEN, FP_FUNCTION_MODULE_NAME,
* the form's generated function module (interface IS_HEADER, IT_ITEMS), FP_JOB_CLOSE.
* The data comes from ZCL_PO_SERVICE->READ.

PARAMETERS p_ebeln TYPE zpo_ebeln DEFAULT '4500000001' OBLIGATORY.
PARAMETERS p_prev AS CHECKBOX DEFAULT 'X'.

START-OF-SELECTION.
  DATA ls_po TYPE zpo_s_po.
  DATA ls_header TYPE zpo_head.
  DATA lt_items TYPE STANDARD TABLE OF zpo_item WITH DEFAULT KEY.
  DATA lx_po TYPE REF TO zcx_po_error.
  DATA ls_outputparams TYPE sfpoutputparams.
  DATA ls_docparams TYPE sfpdocparams.
  DATA ls_formoutput TYPE fpformoutput.
  DATA lv_fm_name TYPE rs38l_fnam.

  TRY.
      ls_po = NEW zcl_po_service( )->read( p_ebeln ).
    CATCH zcx_po_error INTO lx_po.
      WRITE: / 'Purchase order', p_ebeln, 'not found'.
      RETURN.
  ENDTRY.
  ls_header = CORRESPONDING #( ls_po ).
  SELECT * FROM zpo_item WHERE ebeln = @p_ebeln ORDER BY ebelp INTO TABLE @lt_items.

  ls_outputparams-getpdf = p_prev.
  ls_outputparams-covtitle = |Purchase order { p_ebeln }|.
  CALL FUNCTION 'FP_JOB_OPEN'
    CHANGING
      ie_outputparams = ls_outputparams
    EXCEPTIONS
      OTHERS          = 1.
  IF sy-subrc <> 0.
    WRITE: / 'FP_JOB_OPEN failed'.
    RETURN.
  ENDIF.
  CALL FUNCTION 'FP_FUNCTION_MODULE_NAME'
    EXPORTING
      i_name     = 'ZF_PO_PRINT'
    IMPORTING
      e_funcname = lv_fm_name.
  ls_docparams-langu = 'E'.
  CALL FUNCTION lv_fm_name
    EXPORTING
      /1bcdwb/docparams  = ls_docparams
      is_header          = ls_header
      it_items           = lt_items
    IMPORTING
      /1bcdwb/formoutput = ls_formoutput
    EXCEPTIONS
      OTHERS             = 1.
  CALL FUNCTION 'FP_JOB_CLOSE'
    EXCEPTIONS
      OTHERS = 1.
  WRITE: / |Form function module { lv_fm_name }|.
  IF p_prev = abap_true.
    WRITE: / |PDF with { ls_formoutput-pages } page(s), { xstrlen( ls_formoutput-pdf ) } bytes: see the Output page|.
  ELSE.
    WRITE: / 'Sent to the output queue'.
  ENDIF.
