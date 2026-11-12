CLASS zcl_fb DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_doc,
             doc_id    TYPE c LENGTH 10,
             reference TYPE c LENGTH 20,
           END OF ty_doc,
           tt_doc TYPE STANDARD TABLE OF ty_doc WITH EMPTY KEY.
    CLASS-METHODS add_subtract RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS where_reference RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS cast_statement RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS p_max RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS zero_date RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS range_body RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS sort_by_value RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS p_exact RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_fb IMPLEMENTATION.
  METHOD add_subtract.
    DATA x TYPE i VALUE 5.
    DATA p TYPE p LENGTH 8 DECIMALS 2 VALUE '1.50'.
    ADD 3 TO x.
    SUBTRACT 2 FROM x.
    ADD x TO p.
    SUBTRACT '0.25' FROM p.
    rv = |{ x }/{ p }|.
  ENDMETHOD.

  METHOD where_reference.
    DATA(docs) = VALUE tt_doc( ( doc_id = '1' reference = 'A' ) ( doc_id = '2' reference = 'B' ) ( doc_id = '3' reference = 'B' ) ).
    DATA n TYPE i.
    LOOP AT docs INTO DATA(doc) WHERE reference = 'B'.
      n = n + 1.
    ENDLOOP.
    DELETE FROM zfbdoc_a.
    INSERT zfbdoc_a FROM TABLE @( VALUE #( ( doc_id = '1' reference = 'A' ) ( doc_id = '2' reference = 'B' ) ) ).
    SELECT doc_id FROM zfbdoc_a WHERE reference = 'B' INTO TABLE @DATA(ids).
    READ TABLE docs WITH KEY reference = 'A' INTO DATA(first).
    rv = |{ n }/{ lines( ids ) }/{ first-doc_id }|.
  ENDMETHOD.

  METHOD cast_statement.
    zcl_fb_impl=>count = 0.
    CAST zif_fb( NEW zcl_fb_impl( ) )->bump( ).
    CAST zif_fb( NEW zcl_fb_impl( ) )->bump( ).
    rv = |{ zcl_fb_impl=>count }|.
  ENDMETHOD.

  METHOD p_max.
    DATA p TYPE p LENGTH 16 DECIMALS 6.
    p = '9999999999999999999999999.999999'.
    DATA q TYPE p LENGTH 16 DECIMALS 6 VALUE '-9999999999999999999999999.999999'.
    rv = |{ p }/{ q }|.
  ENDMETHOD.

  METHOD zero_date.
    DATA d TYPE d.
    DATA n TYPE n LENGTH 8.
    d = '00000000'.
    n = '00000000'.
    DATA(d2) = CONV d( '00000000' ).
    rv = COND #( WHEN d IS INITIAL THEN 'X' ELSE '-' ) && COND #( WHEN n IS INITIAL THEN 'X' ELSE '-' ) && COND #( WHEN d2 IS INITIAL THEN 'X' ELSE '-' ).
  ENDMETHOD.

  METHOD range_body.
    DATA r TYPE RANGE OF i.
    r = VALUE #( ( sign = 'I' option = 'EQ' low = 1 ) ( sign = 'I' option = 'BT' low = 5 high = 7 ) ).
    DATA s TYPE i.
    LOOP AT r[] INTO DATA(line).
      s = s + line-low.
    ENDLOOP.
    DATA(c) = lines( r[] ).
    rv = |{ c }/{ s }/{ COND #( WHEN 6 IN r[] THEN 'in' ELSE 'out' ) }/{ COND #( WHEN r[] IS NOT INITIAL THEN 'full' ELSE 'empty' ) }|.
  ENDMETHOD.

  METHOD sort_by_value.
    TYPES: BEGIN OF ty_s, comp1 TYPE i, comp2 TYPE c LENGTH 1, END OF ty_s.
    DATA it TYPE STANDARD TABLE OF ty_s WITH EMPTY KEY.
    it = VALUE #( ( comp1 = 2 comp2 = 'b' ) ( comp1 = 3 comp2 = 'a' ) ( comp1 = 1 comp2 = 'c' ) ).
    SORT it BY VALUE abap_sortorder_tab( ( name = `COMP1` descending = 'X' ) ).
    DATA(first) = REDUCE string( INIT t = `` FOR r IN it NEXT t = t && |{ r-comp1 }| ).
    DATA(names) = VALUE string_table( ( `comp2` ) ).
    SORT it BY VALUE abap_sortorder_tab( FOR n IN names ( name = condense( to_upper( n ) ) ) ).
    DATA(second) = REDUCE string( INIT t = `` FOR r IN it NEXT t = t && r-comp2 ).
    rv = |{ first }/{ second }|.
  ENDMETHOD.

  METHOD p_exact.
    DATA p TYPE p LENGTH 16 DECIMALS 6.
    DATA q TYPE p LENGTH 16 DECIMALS 6.
    p = '9999999999999999999999999.999999'.
    q = '-1234567890123456789012345.123456'.
    DATA(s1) = |{ p }|.
    q = q + '0.000001'.
    DATA r TYPE p LENGTH 16 DECIMALS 6.
    r = p - '0.000001'.
    DATA(cmp) = COND string( WHEN r < p THEN `lt` ELSE `ge` ).
    DATA z TYPE p LENGTH 16 DECIMALS 6.
    z = p - p.
    DATA(zero) = COND string( WHEN z IS INITIAL THEN `0` ELSE `x` ).
    rv = |{ s1 }/{ q }/{ r }/{ cmp }/{ zero }/{ CONV string( p ) }|.
  ENDMETHOD.
ENDCLASS.
