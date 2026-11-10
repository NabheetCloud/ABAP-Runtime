@EndUserText.label : 'Addresses'
define table adrc {
  key mandt      : abap.clnt not null;
  key addrnumber : abap.char(10) not null;
  key date_from  : abap.dats not null;
  key nation     : abap.char(1) not null;
  name1          : abap.char(40);
  name2          : abap.char(40);
  street         : abap.char(60);
  house_num1     : abap.char(10);
  post_code1     : abap.char(10);
  city1          : abap.char(40);
  country        : abap.char(3);
  region         : abap.char(3);
  langu          : abap.lang;
  tel_number     : abap.char(30);
  smtp_addr      : abap.char(241);
}
