@EndUserText.label : 'Output (old output control)'
define table nast {
  key mandt : abap.clnt not null;
  key kappl : abap.char(2) not null;
  key objky : abap.char(30) not null;
  key kschl : abap.char(4) not null;
  key spras : abap.lang not null;
  key parnr : abap.numc(10) not null;
  key parvw : abap.char(2) not null;
  key erdat : abap.dats not null;
  key eruhr : abap.tims not null;
  vsztp     : abap.char(1);
  vstat     : abap.char(20);
  anzal     : abap.int4;
  nacha     : abap.char(1);
}
