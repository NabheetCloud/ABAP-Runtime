"! Prints a cinema ticket with the Adobe form ZF_CINE_TICKET (XDP layout, data provider ZCINE_TICKET_SRVD), the
"! way SAP's sample ZCL_CINE_APP_OP_RENDER does it: form reader, FDP keys, XML of the data, render, print queue.
CLASS zcl_cine_print_ticket DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.


CLASS zcl_cine_print_ticket IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    TRY.
        DATA(form) = cl_fp_form_reader=>create_form_reader( 'ZF_CINE_TICKET' ).
        DATA(fdp_util) = cl_fp_fdp_services=>get_instance( iv_service_definition = form->get_fdp_name( ) ).

        DATA(select_keys) = fdp_util->get_keys( ).
        select_keys[ name = 'ID' ]-value = '06DBE970F30C1FE0AF991A962D17E17B'.

        DATA(xml) = fdp_util->read_to_xml_v2( it_select = select_keys ).

        cl_fp_ads_util=>render_pdf( EXPORTING iv_locale     = 'en_US'
                                              iv_xml_data   = xml
                                              iv_xdp_layout = form->get_layout( )
                                              is_options    = VALUE #( embed_fonts = form->get_font_embed( )
                                                                       trace_level = 4 )
                                    IMPORTING ev_pdf          = DATA(pdf)
                                              ev_pages        = DATA(pages)
                                              ev_trace_string = DATA(trace) ).
        out->write( |Ticket rendered: { pages } page(s), { xstrlen( pdf ) } bytes| ).
        out->write( trace ).

        " the same for the print queue: print data (PDL) and a queue item
        cl_fp_ads_util=>render_4_pq( EXPORTING iv_pq_name    = 'DEFAULT'
                                               iv_locale     = 'en_US'
                                               iv_xml_data   = xml
                                               iv_xdp_layout = form->get_layout( )
                                               is_options    = VALUE #( trace_level = 0 )
                                     IMPORTING ev_pdl        = DATA(pdl) ).
        DATA(item) = cl_print_queue_utils=>create_queue_item_by_data( iv_qname            = 'DEFAULT'
                                                                      iv_print_data       = pdl
                                                                      iv_name_of_main_doc = |Ticket-{ select_keys[ name = 'ID' ]-value }| ).
        out->write( |Print queue item { item }| ).

        UPDATE zcine_a_buy SET rendered = @abap_true, pdf = @pdf
          WHERE id = '06DBE970F30C1FE0AF991A962D17E17B'.
        IF sy-subrc <> 0.
          out->write( 'The ticket was not found' ).
        ENDIF.
      CATCH cx_fp_fdp_error cx_fp_form_reader cx_fp_ads_util INTO DATA(error).
        out->write( |Error: { error->get_text( ) }| ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
