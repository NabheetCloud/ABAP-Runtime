"! Console demo (run it like F9 in ADT): EML against the Book/Loan BO.
"! Creates a test book with a loan, returns it, checks the rules and deletes the test book again.
CLASS zcl_library_console DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_library_console IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    " 0. Remove leftovers of an aborted earlier run (return open loans first, then delete)
    SELECT FROM zbook_a FIELDS book_uuid WHERE title = 'Console Test Book' INTO TABLE @DATA(leftovers).
    IF leftovers IS NOT INITIAL.
      READ ENTITIES OF zr_book
        ENTITY Book BY \_Loan FIELDS ( ReturnDate )
        WITH VALUE #( FOR lo IN leftovers ( BookUUID = lo-book_uuid ) )
        RESULT DATA(leftover_loans).
      DELETE leftover_loans WHERE ReturnDate IS NOT INITIAL.
      MODIFY ENTITIES OF zr_book
        ENTITY Loan EXECUTE returnBook FROM CORRESPONDING #( leftover_loans ).
      COMMIT ENTITIES.
      MODIFY ENTITIES OF zr_book
        ENTITY Book DELETE FROM VALUE #( FOR lo IN leftovers ( BookUUID = lo-book_uuid ) ).
      COMMIT ENTITIES.
    ENDIF.

    " 1. ABAP SQL on the CDS projections
    SELECT FROM zc_book
      FIELDS Title, Copies, OpenLoans
      ORDER BY Title
      INTO TABLE @DATA(books).
    out->write( data = books name = `Books (ZC_Book)` ).

    SELECT FROM zc_loan
      FIELDS BookTitle, MemberName, LoanDate, DueDate, ReturnDate, LoanStatus, StatusCriticality
      ORDER BY LoanDate
      INTO TABLE @DATA(loans).
    out->write( data = loans name = `Loans (ZC_Loan)` ).

    " 2. Create a book with a loan; loan date and due date are left empty -> defaults
    MODIFY ENTITIES OF zr_book
      ENTITY Book
        CREATE FIELDS ( Title Author ISBN Genre )
        WITH VALUE #( ( %cid = 'B1' Title = 'Console Test Book' Author = 'Test Author'
                        ISBN = '978-3-16-148410-0' Genre = 'Test' ) )
        CREATE BY \_Loan FIELDS ( MemberName MemberEmail )
        WITH VALUE #( ( %cid_ref = 'B1'
                        %target  = VALUE #( ( %cid = 'L1' MemberName = 'Test Member' MemberEmail = 'test.member@example.com' ) ) ) )
      MAPPED DATA(mapped)
      FAILED DATA(failed)
      REPORTED DATA(reported).
    COMMIT ENTITIES RESPONSE OF zr_book FAILED DATA(commit_failed) REPORTED DATA(commit_reported).
    IF commit_failed IS NOT INITIAL.
      LOOP AT commit_reported-book INTO DATA(book_msg) WHERE %msg IS BOUND.
        out->write( |Error: { book_msg-%msg->if_message~get_text( ) }| ).
      ENDLOOP.
      LOOP AT commit_reported-loan INTO DATA(loan_msg) WHERE %msg IS BOUND.
        out->write( |Error: { loan_msg-%msg->if_message~get_text( ) }| ).
      ENDLOOP.
      RETURN.
    ENDIF.

    DATA(book_key) = mapped-book[ 1 ]-%tky.
    READ ENTITIES OF zr_book
      ENTITY Book ALL FIELDS WITH VALUE #( ( %tky = book_key ) )
      RESULT DATA(created_books)
      ENTITY Book BY \_Loan ALL FIELDS WITH VALUE #( ( %tky = book_key ) )
      RESULT DATA(created_loans).
    DATA(loan) = created_loans[ 1 ].
    out->write( |Created book with { created_books[ 1 ]-Copies } copy, loan { loan-LoanDate DATE = ISO } due { loan-DueDate DATE = ISO }, email { loan-MemberEmail }| ).

    " 3. Second loan must fail: the only copy is on loan
    MODIFY ENTITIES OF zr_book
      ENTITY Book CREATE BY \_Loan FIELDS ( MemberName )
      WITH VALUE #( ( %tky = book_key %target = VALUE #( ( %cid = 'L2' MemberName = 'Second Member' ) ) ) ).
    COMMIT ENTITIES RESPONSE OF zr_book FAILED DATA(fail2) REPORTED DATA(rep2).
    out->write( |Second loan rejected: { xsdbool( fail2 IS NOT INITIAL ) }| ).
    LOOP AT rep2-loan INTO DATA(msg2) WHERE %msg IS BOUND.
      out->write( |  { msg2-%msg->if_message~get_text( ) }| ).
    ENDLOOP.
    ROLLBACK ENTITIES.

    " 3b. An email without @ must be rejected
    MODIFY ENTITIES OF zr_book
      ENTITY Loan UPDATE FIELDS ( MemberEmail )
      WITH VALUE #( ( %tky = loan-%tky MemberEmail = 'not-an-email' ) ).
    COMMIT ENTITIES RESPONSE OF zr_book FAILED DATA(fail_mail) REPORTED DATA(rep_mail).
    out->write( |Invalid email rejected: { xsdbool( fail_mail IS NOT INITIAL ) }| ).
    LOOP AT rep_mail-loan INTO DATA(msg_mail) WHERE %msg IS BOUND.
      out->write( |  { msg_mail-%msg->if_message~get_text( ) }| ).
    ENDLOOP.
    ROLLBACK ENTITIES.

    " 4. Delete must fail while the loan is open
    MODIFY ENTITIES OF zr_book
      ENTITY Book DELETE FROM VALUE #( ( %tky = book_key ) )
      FAILED DATA(fail3).
    out->write( |Delete with open loan rejected: { xsdbool( fail3 IS NOT INITIAL ) }| ).
    ROLLBACK ENTITIES.

    " 5. Return the book
    MODIFY ENTITIES OF zr_book
      ENTITY Loan EXECUTE returnBook FROM VALUE #( ( %tky = loan-%tky ) )
      RESULT DATA(returned).
    COMMIT ENTITIES.
    out->write( |After returnBook: return date { returned[ 1 ]-%param-ReturnDate DATE = ISO }| ).

    " 6. Now the book can be deleted (clean up the test data)
    MODIFY ENTITIES OF zr_book
      ENTITY Book DELETE FROM VALUE #( ( %tky = book_key ) )
      FAILED DATA(fail4).
    COMMIT ENTITIES.
    out->write( |Test book deleted after return: { xsdbool( fail4 IS INITIAL ) }| ).
  ENDMETHOD.
ENDCLASS.
