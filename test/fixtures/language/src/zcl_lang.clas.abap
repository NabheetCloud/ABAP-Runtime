CLASS zcl_lang DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row,
             id   TYPE i,
             name TYPE string,
           END OF ty_row,
           tt_rows TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.
    CLASS-METHODS shifts RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS resume RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS cleanup RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS convert RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS find_table RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS xml_roundtrip RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS json RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS rtts RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS lookup RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS groups RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS sql_paths RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS refs RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS trafos RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-DATA gv_log TYPE string.
    CLASS-METHODS divide IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE i RAISING RESUMABLE(zcx_lang_resumable).
    CLASS-METHODS inner CHANGING cv TYPE string RAISING zcx_lang_resumable.
ENDCLASS.

CLASS zcl_lang IMPLEMENTATION.
  METHOD shifts.
    DATA(a) = `abcdef`.
    SHIFT a BY 2 PLACES.
    DATA(b) = `abcdef`.
    SHIFT b BY 2 PLACES RIGHT CIRCULAR.
    DATA(c) = `000123`.
    SHIFT c LEFT DELETING LEADING `0`.
    rv = |{ a }/{ b }/{ c }|.
  ENDMETHOD.

  METHOD divide.
    IF iv = 0.
      RAISE RESUMABLE EXCEPTION TYPE zcx_lang_resumable.
      rv = -1.
      RETURN.
    ENDIF.
    rv = 100 / iv.
  ENDMETHOD.

  METHOD resume.
    DATA lt TYPE STANDARD TABLE OF i WITH EMPTY KEY.
    lt = VALUE #( ( 4 ) ( 0 ) ( 5 ) ).
    LOOP AT lt INTO DATA(n).
      TRY.
          DATA(r) = divide( n ).
          gv_log = gv_log && |{ r };|.
        CATCH BEFORE UNWIND zcx_lang_resumable INTO DATA(e).
          gv_log = gv_log && |resumable={ e->is_resumable };|.
          RESUME.
      ENDTRY.
    ENDLOOP.
    rv = gv_log.
    CLEAR gv_log.
  ENDMETHOD.

  METHOD inner.
    TRY.
        RAISE EXCEPTION TYPE zcx_lang_resumable.
      CLEANUP.
        gv_log = `cleanup;`.
    ENDTRY.
  ENDMETHOD.

  METHOD cleanup.
    TRY.
        inner( CHANGING cv = rv ).
      CATCH zcx_lang_resumable.
        rv = gv_log && `caught`.
    ENDTRY.
    CLEAR gv_log.
  ENDMETHOD.

  METHOD convert.
    DATA(ts) = CONV timestamp( '20240703120000' ).
    CONVERT TIME STAMP ts TIME ZONE 'CET' INTO DATE DATA(d) TIME DATA(t).
    CONVERT DATE '20240101' TIME '100000' INTO TIME STAMP DATA(ts2) TIME ZONE 'INDIA'.
    rv = |{ d } { t } { ts2 }|.
  ENDMETHOD.

  METHOD find_table.
    DATA(lt) = VALUE string_table( ( `alpha` ) ( `beta` ) ( `gamma` ) ).
    FIND FIRST OCCURRENCE OF `mm` IN TABLE lt MATCH LINE DATA(l) MATCH OFFSET DATA(o).
    rv = |{ l }:{ o }|.
  ENDMETHOD.

  METHOD xml_roundtrip.
    DATA(ls) = VALUE ty_row( id = 7 name = `Seven` ).
    DATA ls_back TYPE ty_row.
    CALL TRANSFORMATION id SOURCE row = ls RESULT XML DATA(lv_xml).
    CALL TRANSFORMATION id SOURCE XML lv_xml RESULT row = ls_back.
    rv = |{ ls_back-id }-{ ls_back-name }|.
  ENDMETHOD.

  METHOD json.
    DATA(lt) = VALUE tt_rows( ( id = 1 name = `a` ) ( id = 2 name = `b` ) ).
    rv = /ui2/cl_json=>serialize( data = lt pretty_name = /ui2/cl_json=>pretty_mode-camel_case ).
  ENDMETHOD.

  METHOD rtts.
    DATA(ls) = VALUE ty_row( id = 1 name = `x` ).
    DATA(lo_struct) = CAST cl_abap_structdescr( cl_abap_typedescr=>describe_by_data( ls ) ).
    LOOP AT lo_struct->components INTO DATA(ls_comp).
      rv = rv && |{ ls_comp-name }:{ ls_comp-type_kind };|.
    ENDLOOP.
    rv = rv && cl_abap_typedescr=>describe_by_data( 42 )->type_kind.
  ENDMETHOD.

  METHOD groups.
    DATA(lt) = VALUE tt_rows( ( id = 1 name = `b` ) ( id = 2 name = `a` ) ( id = 3 name = `b` ) ).
    DATA(lt_sum) = VALUE string_table( FOR GROUPS grp OF wa IN lt GROUP BY ( name = wa-name size = GROUP SIZE ) ASCENDING
                                       ( |{ grp-name }:{ grp-size }:{ REDUCE i( INIT s = 0 FOR m IN GROUP grp NEXT s = s + m-id ) }| ) ).
    rv = concat_lines_of( table = lt_sum sep = `,` ).
  ENDMETHOD.

  METHOD sql_paths.
    SELECT empid, \_manager-name AS mgr FROM zi_employee ORDER BY empid INTO TABLE @DATA(lt).
    WITH +mgr AS ( SELECT managerid, COUNT(*) AS cnt FROM zi_employee WHERE managerid IS NOT INITIAL GROUP BY managerid )
      SELECT * FROM +mgr ORDER BY managerid INTO TABLE @DATA(lt2).
    SELECT name FROM zi_employee\_manager AS m ORDER BY name INTO TABLE @DATA(lt3).
    rv = |{ lt[ 2 ]-mgr }/{ lines( lt2 ) }/{ lt2[ 1 ]-cnt }/{ lines( lt3 ) }|.
  ENDMETHOD.

  METHOD refs.
    DATA n TYPE i VALUE 1.
    DATA(r) = REF #( n ).
    r->* = 5.
    DATA lt TYPE STANDARD TABLE OF i WITH EMPTY KEY.
    lt = VALUE #( ( 1 ) ( 2 ) ).
    LOOP AT lt REFERENCE INTO DATA(rr).
      rr->* = rr->* * 10.
    ENDLOOP.
    DATA ls TYPE ty_row.
    GET REFERENCE OF ls INTO DATA(rs).
    rs->name = `via ref`.
    DATA dref TYPE REF TO i.
    CREATE DATA dref.
    dref->* = 7.
    DATA(r2) = dref.
    r2->* = 8.
    rv = |{ n }/{ lt[ 1 ] },{ lt[ 2 ] }/{ ls-name }/{ dref->* }|.
  ENDMETHOD.

  METHOD trafos.
    DATA(lt) = VALUE tt_rows( ( id = 2 name = `Beta` ) ( id = 1 name = `Alpha` ) ).
    DATA lt_back TYPE tt_rows.
    CALL TRANSFORMATION zlang_html SOURCE rows = lt RESULT XML DATA(lv_html).
    CALL TRANSFORMATION zlang_st SOURCE rows = lt RESULT XML DATA(lv_xml).
    CALL TRANSFORMATION zlang_st SOURCE XML lv_xml RESULT rows = lt_back.
    rv = |{ lv_html }#{ lv_xml }#{ lines( lt_back ) }:{ lt_back[ 2 ]-name }|.
  ENDMETHOD.

  METHOD lookup.
    DATA(lt) = VALUE tt_rows( ( id = 1 ) ( id = 2 ) ).
    DATA(lt_names) = VALUE tt_rows( ( id = 2 name = `two` ) ).
    lt = CORRESPONDING #( lt FROM lt_names USING id = id ).
    rv = |{ lt[ 1 ]-name }/{ lt[ 2 ]-name }|.
  ENDMETHOD.
ENDCLASS.
