REPORT zpo_print.

PARAMETERS p_ebeln TYPE zpo_ebeln OBLIGATORY DEFAULT '4500000001'.

DATA ls_head      TYPE zpo_head.
DATA lt_items     TYPE STANDARD TABLE OF zpo_item.
DATA ls_header    TYPE zpo_s_header.
DATA lt_fitems    TYPE zpo_t_item.
DATA ls_outparams TYPE sfpoutputparams.
DATA ls_docparams TYPE sfpdocparams.
DATA ls_formout   TYPE fpformoutput.
DATA lv_fm        TYPE rs38l_fnam.

START-OF-SELECTION.
  TRY.
      NEW zcl_po_service( )->read( EXPORTING iv_ebeln  = p_ebeln
                                   IMPORTING es_header = ls_head
                                             et_items  = lt_items ).
    CATCH zcx_po_error INTO DATA(lx).
      MESSAGE lx->get_text( ) TYPE 'S' DISPLAY LIKE 'E'.
      RETURN.
  ENDTRY.
  MOVE-CORRESPONDING ls_head TO ls_header.
  MOVE-CORRESPONDING lt_items TO lt_fitems.

  CALL FUNCTION 'FP_JOB_OPEN'
    CHANGING   ie_outputparams = ls_outparams
    EXCEPTIONS OTHERS          = 1.
  CALL FUNCTION 'FP_FUNCTION_MODULE_NAME'
    EXPORTING i_name     = 'ZF_PO'
    IMPORTING e_funcname = lv_fm.
  ls_docparams-langu = 'E'.
  CALL FUNCTION lv_fm
    EXPORTING  /1bcdwb/docparams  = ls_docparams
               is_header          = ls_header
               it_items           = lt_fitems
    IMPORTING  /1bcdwb/formoutput = ls_formout
    EXCEPTIONS OTHERS             = 1.
  CALL FUNCTION 'FP_JOB_CLOSE'
    EXCEPTIONS OTHERS = 1.

  WRITE: / |Purchase order { p_ebeln } sent to the output queue|.
