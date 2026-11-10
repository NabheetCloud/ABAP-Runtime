@EndUserText.label : 'BP ↔ supplier link'
define table cvi_vend_link {
  key mandt        : abap.clnt not null;
  key partner_guid : abap.char(32) not null;
  vendor           : abap.char(10);
}
