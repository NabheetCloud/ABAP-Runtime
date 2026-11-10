@EndUserText.label : 'Bank statement note to payee'
define table febre {
  key mandt : abap.clnt not null;
  key kukey : abap.char(8) not null;
  key esnum : abap.char(5) not null;
  key rsnum : abap.char(10) not null;
  vwezw     : abap.char(20);
}
