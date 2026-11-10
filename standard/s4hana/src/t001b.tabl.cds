@EndUserText.label : 'Posting period variant (open periods)'
define table t001b {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key mkoar : abap.char(1) not null;
  key bkont : abap.char(10) not null;
  frye1     : abap.char(20);
  frpe1     : abap.char(20);
  toye1     : abap.char(20);
  tope1     : abap.char(20);
  vkont     : abap.char(20);
}
