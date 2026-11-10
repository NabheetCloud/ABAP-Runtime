@EndUserText.label : 'Bank account master (BAM) ↔ house bank'
define table fclm_bam_aclink2 {
  key mandt  : abap.clnt not null;
  key acc_id : abap.char(10) not null;
  key bukrs  : abap.char(4) not null;
  key hbkid  : abap.char(5) not null;
  key hktid  : abap.char(5) not null;
  bankn      : abap.char(18);
  waers      : abap.cuky;
}
