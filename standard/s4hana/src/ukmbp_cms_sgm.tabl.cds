@EndUserText.label : 'Credit limit per segment'
define table ukmbp_cms_sgm {
  key mandt            : abap.clnt not null;
  key partner          : abap.char(10) not null;
  key credit_sgmnt     : abap.char(10) not null;
  credit_limit         : abap.dec(15,2);
  xblocked             : abap.char(20);
  limit_valid_date     : abap.dats;
}
