@EndUserText.label : 'Business partner addresses'
define table but020 {
  key mandt           : abap.clnt not null;
  key partner         : abap.char(10) not null;
  key addrnumber      : abap.char(10) not null;
  xdfadr              : abap.char(1);
  addr_valid_from     : abap.char(20);
  addr_valid_to       : abap.char(20);
}
