" The handler methods are called by the RAP framework, not by ABAP code: hence ##CALLED.
CLASS lhc_book DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR Book RESULT result ##NEEDED ##CALLED.
    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Book RESULT result ##NEEDED ##CALLED.
    METHODS setDefaultCopies FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Book~setDefaultCopies ##CALLED.
    METHODS validateCopies FOR VALIDATE ON SAVE
      IMPORTING keys FOR Book~validateCopies ##CALLED.
    METHODS validateISBN FOR VALIDATE ON SAVE
      IMPORTING keys FOR Book~validateISBN ##CALLED.
ENDCLASS.

CLASS lhc_book IMPLEMENTATION.

  METHOD get_instance_features.
    " A book cannot be deleted while it has open (not returned) loans
    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Book BY \_Loan
        FIELDS ( ReturnDate ) WITH CORRESPONDING #( keys )
      RESULT DATA(loans)
      LINK DATA(links).

    LOOP AT keys INTO DATA(key).
      DATA(open_loans) = 0.
      LOOP AT links INTO DATA(link) WHERE source-%tky = key-%tky.
        IF VALUE #( loans[ %tky = link-target-%tky ]-ReturnDate OPTIONAL ) IS INITIAL.
          open_loans += 1.
        ENDIF.
      ENDLOOP.

      INSERT VALUE #( %tky    = key-%tky
                      %delete = COND #( WHEN open_loans > 0
                                        THEN if_abap_behv=>fc-o-disabled ELSE if_abap_behv=>fc-o-enabled ) ) INTO TABLE result.
    ENDLOOP.
  ENDMETHOD.

  METHOD get_instance_authorizations.
    " Everyone may do everything in this demo; deny nothing.
    result = VALUE #( FOR key IN keys ( %tky    = key-%tky
                                        %update = if_abap_behv=>auth-allowed
                                        %delete = if_abap_behv=>auth-allowed ) ).
  ENDMETHOD.

  METHOD setDefaultCopies.
    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Book FIELDS ( Copies ) WITH CORRESPONDING #( keys )
      RESULT DATA(books).

    DELETE books WHERE Copies IS NOT INITIAL.
    IF books IS INITIAL.
      RETURN.
    ENDIF.

    MODIFY ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Book
        UPDATE FIELDS ( Copies )
        WITH VALUE #( FOR book IN books ( %tky   = book-%tky
                                          Copies = 1 ) ).
  ENDMETHOD.

  METHOD validateCopies.
    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Book FIELDS ( Copies ) WITH CORRESPONDING #( keys )
      RESULT DATA(books).

    LOOP AT books INTO DATA(book) WHERE Copies < 1.
      INSERT VALUE #( %tky = book-%tky ) INTO TABLE failed-book.
      INSERT VALUE #( %tky            = book-%tky
                      %msg            = new_message( id       = 'ZLIBRARY'
                                                     number   = '003'
                                                     severity = if_abap_behv_message=>severity-error )
                      %element-Copies = if_abap_behv=>mk-on ) INTO TABLE reported-book.
    ENDLOOP.
  ENDMETHOD.

  METHOD validateISBN.
    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Book FIELDS ( ISBN ) WITH CORRESPONDING #( keys )
      RESULT DATA(books).

    LOOP AT books INTO DATA(book) WHERE ISBN IS NOT INITIAL.
      DATA(digits) = condense( val = book-ISBN del = ` ` ).
      REPLACE ALL OCCURRENCES OF `-` IN digits WITH ``.
      REPLACE ALL OCCURRENCES OF ` ` IN digits WITH ``.
      DATA(len) = strlen( digits ).

      IF ( len <> 10 AND len <> 13 ) OR digits CN '0123456789X'.
        INSERT VALUE #( %tky = book-%tky ) INTO TABLE failed-book.
        INSERT VALUE #( %tky          = book-%tky
                        %msg          = new_message( id       = 'ZLIBRARY'
                                                     number   = '004'
                                                     severity = if_abap_behv_message=>severity-error
                                                     v1       = book-ISBN )
                        %element-ISBN = if_abap_behv=>mk-on ) INTO TABLE reported-book.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.

CLASS lhc_loan DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    CONSTANTS loan_period_days TYPE i VALUE 14.

    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR Loan RESULT result ##NEEDED ##CALLED.
    METHODS returnBook FOR MODIFY
      IMPORTING keys FOR ACTION Loan~returnBook RESULT result ##CALLED.
    METHODS printReceipt FOR MODIFY
      IMPORTING keys FOR ACTION Loan~printReceipt RESULT result ##CALLED.
    METHODS setLoanDefaults FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Loan~setLoanDefaults ##CALLED.
    METHODS validateDates FOR VALIDATE ON SAVE
      IMPORTING keys FOR Loan~validateDates ##CALLED.
    METHODS validateAvailability FOR VALIDATE ON SAVE
      IMPORTING keys FOR Loan~validateAvailability ##CALLED.
    METHODS validateEmail FOR VALIDATE ON SAVE
      IMPORTING keys FOR Loan~validateEmail ##CALLED.
ENDCLASS.

CLASS lhc_loan IMPLEMENTATION.

  METHOD get_instance_features.
    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Loan
        FIELDS ( ReturnDate ) WITH CORRESPONDING #( keys )
      RESULT DATA(loans)
      FAILED failed.

    result = VALUE #( FOR loan IN loans
                      ( %tky               = loan-%tky
                        %update            = COND #( WHEN loan-ReturnDate IS NOT INITIAL
                                                     THEN if_abap_behv=>fc-o-disabled ELSE if_abap_behv=>fc-o-enabled )
                        %action-returnBook = COND #( WHEN loan-ReturnDate IS NOT INITIAL
                                                     THEN if_abap_behv=>fc-o-disabled ELSE if_abap_behv=>fc-o-enabled ) ) ).
  ENDMETHOD.

  METHOD returnBook.
    MODIFY ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Loan
        UPDATE FIELDS ( ReturnDate )
        WITH VALUE #( FOR key IN keys ( %tky       = key-%tky
                                        ReturnDate = cl_abap_context_info=>get_system_date( ) ) ).

    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Loan ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(loans).

    result = VALUE #( FOR loan IN loans ( %tky = loan-%tky %param = loan ) ).

    LOOP AT loans INTO DATA(l).
      INSERT VALUE #( %tky = l-%tky
                      %msg = new_message_with_text( severity = if_abap_behv_message=>severity-success
                                                    text     = |Book returned by { l-MemberName }| ) ) INTO TABLE reported-loan.
    ENDLOOP.
  ENDMETHOD.

  " renders the Adobe form ZF_LOAN_RECEIPT (XDP layout, data provider ZFDP_LOAN_RECEIPT) for each loan and keeps the
  " PDF in the loan: the object page offers it for download
  METHOD printReceipt.
    TRY.
        DATA(form) = cl_fp_form_reader=>create_form_reader( 'ZF_LOAN_RECEIPT' ).
        DATA(fdp_util) = cl_fp_fdp_services=>get_instance( iv_service_definition = form->get_fdp_name( ) ).
        DATA(layout) = form->get_layout( ).
      CATCH cx_fp_form_reader cx_fp_fdp_error INTO DATA(setup_error).
        LOOP AT keys INTO DATA(k).
          INSERT VALUE #( %tky = k-%tky ) INTO TABLE failed-loan.
          INSERT VALUE #( %tky = k-%tky
                          %msg = new_message_with_text( text = |Receipt form: { setup_error->get_text( ) }| ) ) INTO TABLE reported-loan.
        ENDLOOP.
        RETURN.
    ENDTRY.

    DATA updates TYPE TABLE FOR UPDATE zr_book\Loan.
    LOOP AT keys INTO DATA(key).
      TRY.
          DATA(select_keys) = fdp_util->get_keys( ).
          select_keys[ name = 'LOANUUID' ]-value = key-LoanUUID.
          DATA(xml) = fdp_util->read_to_xml_v2( it_select = select_keys ).
          cl_fp_ads_util=>render_pdf( EXPORTING iv_locale     = 'en_US'
                                                iv_xml_data   = xml
                                                iv_xdp_layout = layout
                                                is_options    = VALUE #( embed_fonts = form->get_font_embed( ) )
                                      IMPORTING ev_pdf        = DATA(pdf) ).
          INSERT VALUE #( %tky            = key-%tky
                          ReceiptPdf      = pdf
                          ReceiptMimeType = 'application/pdf'
                          ReceiptFileName = |LoanReceipt.pdf| ) INTO TABLE updates.
        CATCH cx_fp_fdp_error cx_fp_ads_util INTO DATA(error).
          INSERT VALUE #( %tky = key-%tky ) INTO TABLE failed-loan.
          INSERT VALUE #( %tky = key-%tky
                          %msg = new_message_with_text( text = |Receipt: { error->get_text( ) }| ) ) INTO TABLE reported-loan.
      ENDTRY.
    ENDLOOP.

    MODIFY ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Loan
        UPDATE FIELDS ( ReceiptPdf ReceiptMimeType ReceiptFileName ) WITH updates.

    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Loan ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(loans).
    result = VALUE #( FOR loan IN loans ( %tky = loan-%tky %param = loan ) ).
    LOOP AT loans INTO DATA(l) WHERE ReceiptPdf IS NOT INITIAL.
      INSERT VALUE #( %tky = l-%tky
                      %msg = new_message_with_text( severity = if_abap_behv_message=>severity-success
                                                    text     = |Receipt for { l-MemberName } is ready| ) ) INTO TABLE reported-loan.
    ENDLOOP.
  ENDMETHOD.

  METHOD setLoanDefaults.
    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Loan FIELDS ( LoanDate DueDate ) WITH CORRESPONDING #( keys )
      RESULT DATA(loans).

    DATA(today) = cl_abap_context_info=>get_system_date( ).

    LOOP AT loans ASSIGNING FIELD-SYMBOL(<loan>).
      IF <loan>-LoanDate IS INITIAL.
        <loan>-LoanDate = today.
      ENDIF.
      " due date defaults to 14 days after the loan date
      IF <loan>-DueDate IS INITIAL OR <loan>-DueDate < <loan>-LoanDate.
        <loan>-DueDate = <loan>-LoanDate + loan_period_days.
      ENDIF.
    ENDLOOP.

    MODIFY ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Loan
        UPDATE FIELDS ( LoanDate DueDate )
        WITH CORRESPONDING #( loans ).
  ENDMETHOD.

  METHOD validateDates.
    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Loan FIELDS ( LoanDate DueDate ) WITH CORRESPONDING #( keys )
      RESULT DATA(loans).

    LOOP AT loans INTO DATA(loan) WHERE DueDate IS NOT INITIAL.
      CHECK loan-DueDate < loan-LoanDate.
      INSERT VALUE #( %tky = loan-%tky ) INTO TABLE failed-loan.
      INSERT VALUE #( %tky             = loan-%tky
                      %msg             = new_message( id       = 'ZLIBRARY'
                                                      number   = '002'
                                                      severity = if_abap_behv_message=>severity-error )
                      %element-DueDate = if_abap_behv=>mk-on ) INTO TABLE reported-loan.
    ENDLOOP.
  ENDMETHOD.

  METHOD validateAvailability.
    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Loan BY \_Book FIELDS ( Title Copies ) WITH CORRESPONDING #( keys )
      RESULT DATA(books)
      LINK DATA(links).

    LOOP AT books INTO DATA(book).
      READ ENTITIES OF zr_book IN LOCAL MODE
        ENTITY Book BY \_Loan FIELDS ( ReturnDate ) WITH VALUE #( ( %tky = book-%tky ) )
        RESULT DATA(book_loans).

      DATA(open_loans) = REDUCE i( INIT n = 0 FOR bl IN book_loans WHERE ( ReturnDate IS INITIAL ) NEXT n = n + 1 ).
      CHECK open_loans > book-Copies.

      LOOP AT links INTO DATA(link) WHERE target-%tky = book-%tky.
        INSERT VALUE #( %tky = link-source-%tky ) INTO TABLE failed-loan.
        INSERT VALUE #( %tky = link-source-%tky
                        %msg = new_message( id       = 'ZLIBRARY'
                                            number   = '001'
                                            severity = if_abap_behv_message=>severity-error
                                            v1       = book-Title
                                            v2       = book-Copies ) ) INTO TABLE reported-loan.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD validateEmail.
    READ ENTITIES OF zr_book IN LOCAL MODE
      ENTITY Loan FIELDS ( MemberEmail ) WITH CORRESPONDING #( keys )
      RESULT DATA(loans).

    " the email is optional, but if it is filled it must contain an @
    LOOP AT loans INTO DATA(loan) WHERE MemberEmail IS NOT INITIAL.
      CHECK loan-MemberEmail NS '@'.
      INSERT VALUE #( %tky = loan-%tky ) INTO TABLE failed-loan.
      INSERT VALUE #( %tky                 = loan-%tky
                      %msg                 = new_message( id       = 'ZLIBRARY'
                                                          number   = '005'
                                                          severity = if_abap_behv_message=>severity-error
                                                          v1       = loan-MemberEmail )
                      %element-MemberEmail = if_abap_behv=>mk-on ) INTO TABLE reported-loan.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
