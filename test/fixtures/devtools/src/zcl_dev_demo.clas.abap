CLASS zcl_dev_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    METHODS divide IMPORTING a TYPE i b TYPE i RETURNING VALUE(r) TYPE i.
ENDCLASS.

CLASS zcl_dev_demo IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    SELECT id, name FROM zdev_item WHERE id >= @( 1 ) ORDER BY id INTO TABLE @DATA(items).
    DATA(count) = lines( items ).
    out->write( |{ count } items| ).
    count = divide( a = count b = 0 ).
  ENDMETHOD.

  METHOD divide.
    DATA tmp TYPE i.
    tmp = a * 10.
    r = tmp / b.
  ENDMETHOD.
ENDCLASS.
