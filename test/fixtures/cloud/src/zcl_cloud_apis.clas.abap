CLASS zcl_cloud_apis DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA url TYPE string.
    CLASS-METHODS encodings RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS numbers RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS logs RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS http RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS mail RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS background RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS schedule IMPORTING text TYPE string RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS job_status IMPORTING jobname TYPE string jobcount TYPE string RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_cloud_apis IMPLEMENTATION.
  METHOD encodings.
    DATA hash TYPE string.
    DATA hmac TYPE string.
    cl_abap_message_digest=>calculate_hash_for_char( EXPORTING if_algorithm = 'SHA256' if_data = `abc` IMPORTING ef_hashstring = hash ).
    cl_abap_message_digest=>calculate_hmac_for_char( EXPORTING if_algorithm = 'SHA1' if_key = '6B6579' if_data = `abc` IMPORTING ef_hmacstring = hmac ).
    DATA(b64) = cl_web_http_utility=>encode_base64( `Hé` ).
    DATA(back) = cl_web_http_utility=>decode_base64( b64 ).
    DATA(bytes) = cl_abap_conv_codepage=>create_out( )->convert( `Hé` ).
    DATA(text) = cl_abap_conv_codepage=>create_in( )->convert( bytes ).
    rv = |{ hash(16) }/{ hmac(8) }/{ b64 }/{ back }/{ bytes }/{ text }/{ cl_web_http_utility=>escape_url( `a b&c` ) }|.
  ENDMETHOD.

  METHOD numbers.
    DATA n1 TYPE cl_numberrange_runtime=>nr_number.
    DATA n2 TYPE cl_numberrange_runtime=>nr_number.
    DATA n3 TYPE cl_numberrange_runtime=>nr_number.
    cl_numberrange_intervals=>create( interval = VALUE #( ( nrrangenr = '02' fromnumber = '5000' tonumber = '5002' ) ) object = 'ZORDER' ).
    cl_numberrange_runtime=>number_get( EXPORTING nr_range_nr = '01' object = 'ZORDER' IMPORTING number = n1 ).
    cl_numberrange_runtime=>number_get( EXPORTING nr_range_nr = '01' object = 'ZORDER' IMPORTING number = n2 ).
    cl_numberrange_runtime=>number_get( EXPORTING nr_range_nr = '02' object = 'ZORDER' quantity = 3 IMPORTING number = n3 ).
    rv = |{ n1 }/{ n2 }/{ n3 }|.
    TRY.
        cl_numberrange_runtime=>number_get( EXPORTING nr_range_nr = '02' object = 'ZORDER' IMPORTING number = n3 ).
      CATCH cx_number_ranges.
        rv = rv && '/exhausted'.
    ENDTRY.
  ENDMETHOD.

  METHOD logs.
    DATA(log) = cl_bali_log=>create( ).
    log->set_header( cl_bali_header_setter=>create( object = 'ZAPP' subobject = 'IMPORT' external_id = 'RUN1' ) ).
    log->add_item( cl_bali_free_text_setter=>create( severity = if_bali_constants=>c_severity_warning text = `Price missing` ) ).
    log->add_item( cl_bali_free_text_setter=>create( severity = if_bali_constants=>c_severity_error text = `Order failed` ) ).
    cl_bali_log_db=>get_instance( )->save_log( log = log ).
    DATA(loaded) = cl_bali_log_db=>get_instance( )->load_log( log->get_handle( ) ).
    DATA(items) = loaded->get_all_items( ).
    SELECT SINGLE errors, warnings, object FROM zrap_balhdr WHERE log_handle = @( log->get_handle( ) ) INTO @DATA(hdr).
    rv = |{ lines( items ) }/{ items[ 2 ]-item->get_message_text( ) }/{ hdr-errors }/{ hdr-warnings }/{ hdr-object }|.
  ENDMETHOD.

  METHOD http.
    DATA(client) = cl_web_http_client_manager=>create_by_http_destination( cl_http_destination_provider=>create_by_url( url ) ).
    DATA(request) = client->get_http_request( ).
    request->set_uri_path( `/echo` ).
    request->set_query( `x=1` ).
    request->set_header_field( i_name = `X-Test` i_value = `abap` ).
    request->set_text( `{"a":1}` ).
    DATA(response) = client->execute( if_web_http_client=>post ).
    rv = |{ response->get_status( )-code }/{ response->get_text( ) }/{ response->get_header_field( `x-echo` ) }|.
    client->close( ).
    TRY.
        cl_http_destination_provider=>create_by_cloud_destination( i_name = 'NOT_THERE' ).
      CATCH cx_http_dest_provider_error.
        rv = rv && '/no destination'.
    ENDTRY.
  ENDMETHOD.

  METHOD background.
    DATA(monitor) = cl_bgmc_process_factory=>get_default( )->create(
      )->set_name( `Notify` )->set_operation_tx_uncontrolled( NEW zcl_cloud_bgpf( `after commit` ) )->save_for_execution( ).
    SELECT COUNT(*) FROM zcloud_run WHERE source = 'BGPF' INTO @DATA(before).
    COMMIT WORK.
    SELECT COUNT(*) FROM zcloud_run WHERE source = 'BGPF' INTO @DATA(after).
    rv = |{ before }/{ after }/{ monitor->get_state( ) }|.
  ENDMETHOD.

  METHOD schedule.
    cl_apj_rt_api=>schedule_job(
      EXPORTING iv_job_template_name   = 'ZJT_CLOUD_IMPORT'
                iv_job_text            = 'Import orders'
                is_start_info          = VALUE #( start_immediately = abap_true )
                it_job_parameter_value = VALUE #( ( name = 'P_TEXT' t_value = VALUE #( ( sign = 'I' option = 'EQ' low = text ) ) ) )
      IMPORTING ev_jobname  = DATA(jobname)
                ev_jobcount = DATA(jobcount) ).
    rv = |{ jobname }:{ jobcount }|.
  ENDMETHOD.

  METHOD job_status.
    cl_apj_rt_api=>get_job_status( EXPORTING iv_jobname = jobname iv_jobcount = jobcount IMPORTING ev_job_status = DATA(status) ev_job_status_text = DATA(text) ).
    rv = |{ status } { text }|.
  ENDMETHOD.

  METHOD mail.
    DATA(m) = cl_bcs_mail_message=>create_instance( ).
    m->set_sender( 'noreply@example.com' ).
    m->add_recipient( 'a@example.com' ).
    m->set_subject( 'Order 4711' ).
    m->set_main( cl_bcs_mail_textpart=>create_instance( iv_content = `Your order is confirmed.` iv_content_type = 'text/plain' ) ).
    m->add_attachment( cl_bcs_mail_binarypart=>create_instance( iv_content = '48656C6C6F' iv_content_type = 'text/plain' iv_filename = 'hello.txt' ) ).
    m->send( ).
    SELECT SINGLE subject, recipients, attachments FROM rap_mail_outbox INTO @DATA(sent).
    rv = |{ sent-subject }/{ sent-recipients }/{ sent-attachments }|.
  ENDMETHOD.
ENDCLASS.
