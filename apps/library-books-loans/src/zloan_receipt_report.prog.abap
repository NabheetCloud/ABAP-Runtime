REPORT zloan_receipt_report.

* Prints the loan receipt with the Adobe form ZF_LOAN_RECEIPT the classic way (SAP Interactive Forms by Adobe):
* FP_JOB_OPEN, FP_FUNCTION_MODULE_NAME, the form's generated function module, FP_JOB_CLOSE. The form interface
* parameter LOANRECEIPT has the components the XDP binds ($.LoanReceipt.BookTitle …).

TYPES: BEGIN OF ty_receipt,
         loanuuid      TYPE sysuuid_x16,
         booktitle     TYPE c LENGTH 120,
         author        TYPE c LENGTH 80,
         isbn          TYPE c LENGTH 17,
         genre         TYPE c LENGTH 30,
         membername    TYPE c LENGTH 80,
         memberemail   TYPE c LENGTH 120,
         loandate      TYPE d,
         duedate       TYPE d,
         returndate    TYPE d,
         referencedate TYPE d,
       END OF ty_receipt.

PARAMETERS p_member TYPE c LENGTH 80 LOWER CASE DEFAULT 'Priya Sharma'.
PARAMETERS p_prev   AS CHECKBOX DEFAULT 'X'.

CLASS lcl_receipt DEFINITION FINAL.
  PUBLIC SECTION.
    CLASS-METHODS run.
  PRIVATE SECTION.
    CLASS-METHODS read_loan RETURNING VALUE(rs_receipt) TYPE ty_receipt.
ENDCLASS.

CLASS lcl_receipt IMPLEMENTATION.
  METHOD run.
    DATA(ls_receipt) = read_loan( ).
    IF ls_receipt IS INITIAL.
      MESSAGE |No loan found for { p_member }| TYPE 'S' DISPLAY LIKE 'E'.
      RETURN.
    ENDIF.

    DATA ls_outputparams TYPE sfpoutputparams.
    DATA ls_docparams    TYPE sfpdocparams.
    DATA ls_formoutput   TYPE fpformoutput.
    DATA lv_fm_name      TYPE rs38l_fnam.

    " the PDF back (preview) or the output queue (print)
    ls_outputparams-getpdf   = p_prev.
    ls_outputparams-covtitle = |Loan receipt { ls_receipt-membername }|.
    CALL FUNCTION 'FP_JOB_OPEN'
      CHANGING
        ie_outputparams = ls_outputparams
      EXCEPTIONS
        cancel          = 1
        usage_error     = 2
        system_error    = 3
        internal_error  = 4
        OTHERS          = 5.
    IF sy-subrc <> 0.
      MESSAGE 'The form processing could not be started' TYPE 'E'.
    ENDIF.

    CALL FUNCTION 'FP_FUNCTION_MODULE_NAME'
      EXPORTING
        i_name     = 'ZF_LOAN_RECEIPT'
      IMPORTING
        e_funcname = lv_fm_name.

    ls_docparams-langu   = 'E'.
    ls_docparams-country = 'US'.
    CALL FUNCTION lv_fm_name
      EXPORTING
        /1bcdwb/docparams  = ls_docparams
        loanreceipt        = ls_receipt
      IMPORTING
        /1bcdwb/formoutput = ls_formoutput
      EXCEPTIONS
        usage_error        = 1
        system_error       = 2
        internal_error     = 3
        OTHERS             = 4.
    IF sy-subrc <> 0.
      MESSAGE 'The receipt could not be rendered' TYPE 'E'.
    ENDIF.

    CALL FUNCTION 'FP_JOB_CLOSE'
      EXCEPTIONS
        usage_error    = 1
        system_error   = 2
        internal_error = 3
        OTHERS         = 4.

    WRITE: / |Loan receipt for { ls_receipt-membername }: "{ ls_receipt-booktitle }"|.
    WRITE: / |Due date { ls_receipt-duedate DATE = USER }|.
    IF p_prev = abap_true.
      WRITE: / |PDF rendered: { ls_formoutput-pages } page(s), { xstrlen( ls_formoutput-pdf ) } bytes|.
    ELSE.
      WRITE: / 'The receipt was sent to the output queue (Output)'.
    ENDIF.
  ENDMETHOD.

  METHOD read_loan.
    " the member's open loan with the oldest due date, else their latest loan
    SELECT FROM zloan_a AS l
      INNER JOIN zbook_a AS b ON b~book_uuid = l~parent_uuid
      FIELDS l~loan_uuid AS loanuuid, b~title AS booktitle, b~author, b~isbn, b~genre,
             l~member_name AS membername, l~member_email AS memberemail,
             l~loan_date AS loandate, l~due_date AS duedate, l~return_date AS returndate
      WHERE l~member_name = @p_member
      ORDER BY l~return_date ASCENDING, l~due_date ASCENDING
      INTO TABLE @DATA(lt_loans)
      UP TO 1 ROWS.
    IF lt_loans IS INITIAL.
      RETURN.
    ENDIF.
    rs_receipt = CORRESPONDING #( lt_loans[ 1 ] ).
    rs_receipt-referencedate = sy-datum.
  ENDMETHOD.
ENDCLASS.

START-OF-SELECTION.
  lcl_receipt=>run( ).
