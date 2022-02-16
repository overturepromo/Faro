/*
 *Author: Jacob Goodall
 *Date: 01/17/2022
 *Description: Send Orders to FARO
 */

 //new notes
 //occurred to me later: you may  need to JSON.parse() the resBody before querying it for the order ids
//also, we never set the docNumber variable used in the error email, so that'll fail until we set it

function sendSO() {

	//define header object for nlapiRequestURL() call
	var header = {
    'Cache-Control' : 'no-cache',
		'Content-Type' : 'application/json',
		'Authorization':'ZeRuuM3HfZHJHwkG0JomklVHVbnhN7EB'
	};

  //se: FARO Orders for Integration
  //Update to Production search
	var results = nlapiSearchRecord('salesorder','customsearch5105');

	if(results) {

    var checkGovernance = function() {

			var governanceThreshold = 500;
			var context = nlapiGetContext();

			if(context.getRemainingUsage() < governanceThreshold) {

				try{
					
					var script = nlapiScheduleScript('customscript_op_sched_faro_orders');

          if(script == 'QUEUED') {
            nlapiLogExecution('ERROR','Re-scheduling due to governance', 'Successful re-schedule.');
            return true;
          }
          else {
            nlapiLogExecution('ERROR','Problem re-scheduling.', e.code+' : '+e.message);
            return true;
          }
					
				}
				catch(e) {
					nlapiLogExecution('ERROR','Problem re-scheduling.', e.code+' : '+e.message);
					return true;
				}
			}
			else {
				return false;
			}

		};

    for(var i = 0; i<results.length; i++) {

      try {

        //            tranid: '',
        var payload = { 
            custbody_webstoreordernumber: '',
            tranid: '',
	          internalid: '',
            shipaddressee: '', 
            shipattention: '',
            shipaddr1: '',
            shipaddr2: '',
            shipcity: '', 
            shipstate: '',
            shipzip: '',
            shipphone: '',
            shipcountry: '',
            receivebydate: '',
            email: '',
            specialinstructions: '',
            lines: [] 
        }

        var rec = nlapiLoadRecord('salesorder',results[i].getValue('internalid',null,'GROUP'));
        var tranId = rec.getFieldValue('tranid');

        payload.custbody_webstoreordernumber = rec.getFieldValue('otherrefnum');
        payload.tranid = rec.getFieldValue('tranid');
        payload.internalid = rec.getId();
        payload.shipaddressee =  rec.getFieldValue('shipaddressee');
        payload.shipattention = rec.getFieldValue('shipattention');
        payload.shipaddr1 = rec.getFieldValue('shipaddr1')
        payload.shipaddr2 = rec.getFieldValue('shipaddr2')
        payload.shipcity = rec.getFieldValue('shipcity');
        payload.shipstate = rec.getFieldValue('shipstate');
        payload.shipzip = rec.getFieldValue('shipzip');
        payload.shipphone = rec.getFieldValue('custbody_shiptophone');
        payload.shipcountry = rec.getFieldValue('shipcountry');
        payload.receivebydate = rec.getFieldValue('enddate'); 
        payload.email = rec.getFieldValue('custbody_customer_email');
        payload.specialinstructions = rec.getFieldValue('custbody_special_instructions');
        
        var backordersPresent = false;
        var modifyTranId = false;

        var lineItemCount = 1

        for(var x=1; x<=rec.getLineItemCount('item'); x++) {
          //Checking location 25/Belgium is true
          if(rec.getLineItemValue('item', 'location', x) == 25){
            var item = rec.getLineItemText('item','item',x);
            //check if in stock
            if(rec.getLineItemValue('item','quantitybackordered',x) < 1) {
                
              //check if matrix item, strip out parent item if so
              if(item.indexOf(':') !== -1) {
                item = item.substring(item.indexOf(':')+2);
              }

              if(rec.getLineItemValue('item','custcol_3rd_party_order_id',x) == '' || rec.getLineItemValue('item','custcol_3rd_party_order_id',x) == null) {
                payload.lines.push(
                  {
                    line: lineItemCount,
                    item: item,
                    quantity: Number(rec.getLineItemValue('item','quantitycommitted',x)),
                    description: rec.getLineItemValue('item','description',x)
                  }
                );
                lineItemCount++;
              }
              else {
                modifyTranId = true;
              }  
            }
            else {
              backordersPresent = true;
            }
          }
        }

        if(payload.lines.length > 0) {

          // if(modifyTranId) {
          //   payload.tranid = rec.getFieldValue('tranid')+'-BO';
          // }
          // else {
          //   payload.tranid = rec.getFieldValue('tranid');
          // }

          //force feeding product to be something in their stystem for testing.
          //payload.lines[0].item = 'FARO091';

          //json callback function to make null fields to an empty string
          rec.setFieldValue('custbody_ariba_cxml_message',JSON.stringify(payload, function (key, value) { return (value === null) ? '' : value;}));
          nlapiLogExecution('AUDIT','Outbound Payload',JSON.stringify(payload, function (key, value) { return (value === null) ? '' : value;}));



          var response = nlapiRequestURL(
            'https://overture.crea2print.com/json/order/',//may need to remove last /
            JSON.stringify(payload, function (key, value) { return (value === null) ? '' : value;}),
            header,
            null,
            'POST'
          );

          var fullResponse = JSON.stringify(response);
  
          var resCode = response.getCode();
          var resBody = response.getBody();
          var resBodyJson = JSON.parse(resBody);
          var resString = resCode+'\n'+JSON.stringify(resBody);
  
          nlapiLogExecution('AUDIT','FARO Response',resBody);

  
          if(resCode === 201) {

            var orderIdObj = resBodyJson.orderid;
            var newOrderId = Object.keys(orderIdObj)[0];

            //set FARO's orderid in new custom line field custcol_3rd_party_order_id
            for(var x=1; x<=rec.getLineItemCount('item'); x++) {
              if(rec.getLineItemValue('item', 'location', x) == 25){
                if(rec.getLineItemValue('item','quantitybackordered',x) < 1) {
                  if(rec.getLineItemValue('item','custcol_3rd_party_order_id',x) == '' || rec.getLineItemValue('item','custcol_3rd_party_order_id',x) == null) {
                    rec.setLineItemValue('item','custcol_3rd_party_order_id', x, newOrderId);
                  }
                }
              }
            }

            if(!backordersPresent) {

              //This removes it from saved search if everything is in stock so much have no backoderes lines
              //rec.setFieldValue('custbody_outbound_processing_complete','T');

            }
  
            nlapiSubmitRecord(rec);
            nlapiLogExecution('AUDIT','SUCCESS',rec.getFieldValue('tranid')+' created successfully in FAROs system');

          }
  
          //else if errors are present, log them and email jacobg@overturepromo.com or kevind@overturepromo.com
          else {
  
            nlapiLogExecution('ERROR','FARO Error',resString);
  
            nlapiSendEmail(
              '5009366',
              'jacobg@overturepromo.com',
              'FARO Error '+ tranId,
              tranId+'\r\n'+resString,
              null,
              null,
              null,
              null
            );
            
            //still need to submit record to store outbound payload
            nlapiSubmitRecord(rec);
  
          }
        }

        if(i % 10 == 0) {
          if(checkGovernance() == true) {
            break;
          }	
        }
      }

      catch(e) {
        var error = e.code+' :: '+e.message;
        nlapiLogExecution('ERROR','Try / Catch Error',error);
        nlapiSendEmail(
          '5009366',
          'jacobg@overturepromo.com',
          'Faro Error Main Try/Catch Error',
          error.toString(),
          null,
          null,
          null,
          null
        );
      }
    }
	}
}

