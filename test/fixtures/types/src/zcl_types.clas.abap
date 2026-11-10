CLASS zcl_types DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ENUM t_color, red, green, blue, END OF ENUM t_color.
    TYPES: BEGIN OF ty_rec,
             code  TYPE c LENGTH 3,
             num   TYPE n LENGTH 5,
             amt   TYPE p LENGTH 3 DECIMALS 2,
           END OF ty_rec.
    CLASS-METHODS fixed_length RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS numbers RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS overflow RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS calc_types RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS loops RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS enums RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS big RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS memory RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS classic_exc IMPORTING fail TYPE abap_bool EXCEPTIONS not_found.
    CLASS-METHODS exceptions RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS functions RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS files RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_types IMPLEMENTATION.
  METHOD fixed_length.
    DATA c3 TYPE c LENGTH 3.
    DATA n5 TYPE n LENGTH 5.
    DATA x2 TYPE x LENGTH 2.
    DATA rec TYPE ty_rec.
    c3 = 'ABCDEF'.
    n5 = 42.
    x2 = 'FF'.
    rec-code = 'WXYZ'.
    rec-num = 'a1b2'.
    DATA c5 TYPE c LENGTH 5.
    c5 = 42.
    rv = |{ c3 }/{ n5 }/{ x2 }/{ rec-code }/{ rec-num }/{ c5 }/{ xstrlen( x2 ) }|.
  ENDMETHOD.

  METHOD numbers.
    DATA f TYPE f.
    DATA d34 TYPE decfloat34.
    DATA p2 TYPE p LENGTH 8 DECIMALS 2.
    f = '0.815'.
    d34 = '0.815'.
    p2 = '- 1.005'.
    DATA(res) = 0.
    res = 2 / 3.
    DATA(res2) = 3 * ( 1 / 3 ).
    rv = |{ xsdbool( f <> d34 ) }/{ p2 }/{ res }/{ res2 }/{ round( val = '2.5' dec = 0 mode = cl_abap_math=>round_half_even ) }|.
  ENDMETHOD.

  METHOD overflow.
    DATA i TYPE i VALUE 2147483647.
    DATA p TYPE p LENGTH 2 DECIMALS 0.
    TRY.
        i = i + 1.
      CATCH cx_sy_arithmetic_overflow.
        rv = 'arith'.
    ENDTRY.
    TRY.
        p = 1000.
      CATCH cx_sy_conversion_overflow.
        rv = rv && '/conv'.
    ENDTRY.
    TRY.
        i = 1 / 0.
      CATCH cx_sy_arithmetic_error.
        rv = rv && '/zerodivide'.
    ENDTRY.
    TRY.
        i = `1E3`.
      CATCH cx_sy_conversion_no_number.
        rv = rv && '/notation'.
    ENDTRY.
  ENDMETHOD.

  METHOD calc_types.
    DATA pd3 TYPE p LENGTH 16 DECIMALS 3 VALUE '1.326'.
    DATA(a) = 2 ** 5.
    DATA(b) = CONV decfloat34( '2.2' ) + pd3.
    DATA(c) = CONV decfloat16( '2.2' ) + 5.
    DATA(d) = pd3 + 1.
    DATA(e) = CONV int8( 2 ) + 2.
    DATA(g) = 2 + 5.
    rv = |{ cl_abap_typedescr=>describe_by_data( a )->type_kind }{ cl_abap_typedescr=>describe_by_data( b )->type_kind }| &&
         |{ cl_abap_typedescr=>describe_by_data( c )->type_kind }{ cl_abap_typedescr=>describe_by_data( d )->type_kind }| &&
         |{ cl_abap_typedescr=>describe_by_data( e )->type_kind }{ cl_abap_typedescr=>describe_by_data( g )->type_kind }| &&
         |/{ cl_abap_typedescr=>describe_by_data( pd3 )->length }|.
  ENDMETHOD.

  METHOD loops.
    DATA n TYPE i.
    WHILE n < 3.
      n = sy-index.
      rv = rv && n.
    ENDWHILE.
    DO 2 TIMES.
      DO 3 TIMES.
      ENDDO.
      rv = rv && |-{ sy-index }|.
    ENDDO.
    DATA(tab) = VALUE string_table( ( `a` ) ( `b` ) ( `c` ) ).
    DATA(rev) = VALUE string_table( FOR w IN tab STEP -1 ( w ) ).
    rv = rv && |/{ concat_lines_of( rev ) }|.
  ENDMETHOD.

  METHOD enums.
    DATA color TYPE t_color.
    DATA(initial) = CONV string( color ).
    color = blue.
    rv = |{ initial }/{ CONV string( color ) }/{ xsdbool( color = blue ) }|.
  ENDMETHOD.

  METHOD memory.
    DATA txt TYPE string VALUE `hello`.
    DATA num TYPE i VALUE 42.
    DATA buffer TYPE xstring.
    DATA back TYPE string.
    DATA back_num TYPE i.
    EXPORT text = txt number = num TO MEMORY ID 'ZTYPES'.
    IMPORT text = back number = back_num FROM MEMORY ID 'ZTYPES'.
    rv = |{ back }-{ back_num }-{ sy-subrc }|.
    IMPORT text = back FROM MEMORY ID 'NOTHING'.
    rv = |{ rv }/{ sy-subrc }|.
    EXPORT txt TO DATA BUFFER buffer.
    CLEAR txt.
    IMPORT txt FROM DATA BUFFER buffer.
    rv = |{ rv }/{ txt }|.
    SET PARAMETER ID 'BUK' FIELD '1010'.
    DATA bukrs TYPE c LENGTH 4.
    GET PARAMETER ID 'BUK' FIELD bukrs.
    rv = |{ rv }/{ bukrs }|.
    ASSIGN ('NUM') TO FIELD-SYMBOL(<n>).
    rv = |{ rv }/{ <n> }/{ sy-subrc }|.
    ASSIGN ('NO_SUCH') TO <n> ELSE UNASSIGN.
    rv = |{ rv }/{ sy-subrc }|.
  ENDMETHOD.

  METHOD classic_exc.
    IF fail = abap_true.
      RAISE not_found.
    ENDIF.
  ENDMETHOD.

  METHOD exceptions.
    classic_exc( EXPORTING fail = abap_true EXCEPTIONS not_found = 4 ).
    rv = |{ sy-subrc }|.
    classic_exc( EXPORTING fail = abap_false EXCEPTIONS OTHERS = 8 ).
    rv = |{ rv }/{ sy-subrc }|.
  ENDMETHOD.

  METHOD functions.
    DATA sum TYPE i.
    DATA log TYPE string_table.
    CALL FUNCTION 'Z_TYP_ADD' EXPORTING iv_a = 3 IMPORTING ev_sum = sum TABLES t_log = log.
    rv = |{ sum }/{ concat_lines_of( log ) }|.
    CALL FUNCTION 'Z_TYP_ADD' EXPORTING iv_a = -1 EXCEPTIONS negative = 7.
    rv = |{ rv }/{ sy-subrc }|.
    CALL FUNCTION 'Z_TYP_ADD' IN UPDATE TASK EXPORTING iv_a = 1 iv_b = 1.
    rv = |{ rv }/{ zfugr_ztyp=>calls }|.
    COMMIT WORK.
    rv = |{ rv }/{ zfugr_ztyp=>calls }|.
  ENDMETHOD.

  METHOD files.
    DATA(file) = `types_test.txt`.
    OPEN DATASET file FOR OUTPUT IN TEXT MODE ENCODING DEFAULT.
    TRANSFER `a` TO file.
    TRANSFER `b` TO file.
    CLOSE DATASET file.
    OPEN DATASET file FOR INPUT IN TEXT MODE ENCODING DEFAULT.
    DATA line TYPE string.
    DO.
      READ DATASET file INTO line.
      IF sy-subrc <> 0.
        EXIT.
      ENDIF.
      rv = rv && line.
    ENDDO.
    CLOSE DATASET file.
    DELETE DATASET file.
  ENDMETHOD.

  METHOD big.
    DATA(b) = cl_abap_bigint=>factory_from_string( `123456789012345678901234567890` )->mul_int4( 3 )->to_string( ).
    DATA(r) = cl_abap_rational=>factory_from_string( `-2/3` )->add_int4( 1 )->to_string( ).
    rv = |{ b }/{ r }|.
  ENDMETHOD.
ENDCLASS.
