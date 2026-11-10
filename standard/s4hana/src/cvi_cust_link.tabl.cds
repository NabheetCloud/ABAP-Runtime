@EndUserText.label : 'BP ↔ customer link'
define table cvi_cust_link {
  key mandt        : abap.clnt not null;
  key partner_guid : abap.char(32) not null;
  customer         : abap.char(10);
}
