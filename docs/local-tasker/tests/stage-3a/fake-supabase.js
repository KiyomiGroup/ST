/* Test double for the Supabase UMD global. Scenario comes from window.__SC. */
(function(){
  var listeners=[];
  function sc(){return window.__SC||{};}
  var session = null;
  try { var s=localStorage.getItem('fake_session'); if(s) session=JSON.parse(s); } catch(e){}
  window.__calls=[];
  window.supabase = { createClient: function(){ return {
    auth: {
      getSession: async function(){ window.__calls.push('getSession'); if(sc().sessionError) return {data:{session:null},error:{message:'boom'}}; return {data:{session:session},error:null}; },
      signInWithPassword: async function(a){ window.__calls.push('signIn'); 
        if(a.password==='unverified') return {data:null,error:{message:'Email not confirmed'}};
        if(a.password!=='good') return {data:null,error:{message:'Invalid login credentials'}};
        session={user:{id:'u1',email:a.email}}; localStorage.setItem('fake_session',JSON.stringify(session)); return {data:{session:session,user:session.user},error:null}; },
      signOut: async function(){ window.__calls.push('signOut'); session=null; localStorage.removeItem('fake_session'); listeners.forEach(function(f){f('SIGNED_OUT',null)}); return {error:null}; },
      onAuthStateChange: function(f){ listeners.push(f); return {data:{subscription:{unsubscribe:function(){}}}}; },
      resetPasswordForEmail: async function(){ window.__calls.push('reset'); return {error:null}; }
    },
    rpc: async function(n){ window.__calls.push('rpc:'+n);
      if(sc().rpcError) return {data:null,error:{message:'server down'}};
      if(n==='is_active_coordinator') return {data: sc().role==='active', error:null};
      if(n==='is_coordinator') return {data: sc().role==='active'||sc().role==='inactive', error:null};
      return {data:null,error:{message:'unknown'}}; },
    from: function(t){
      var q={t:t,filters:{}};
      var chain={
        select:function(){return chain;}, eq:function(k,v){q.filters[k]=v;return chain;}, is:function(){return chain;},
        order:function(){return chain;}, in:function(k,v){q.inList=v;return chain;},
        maybeSingle: async function(){ window.__calls.push('from:'+t);
          if(t==='local_tasker_profiles'){
            if(sc().overviewError) return {data:null,error:{message:'rls'}};
            var id=q.filters.tasker_user_id; var mine=(sc().assignments||[]).indexOf(id)>-1; /* simulates RLS */
            var row=(sc().profiles||[]).filter(function(p){return p.tasker_user_id===id;})[0];
            return {data:(mine&&row)?row:null,error:null};
          }
          return {data:{display_name:'Chidi Okafor',status:'active'},error:null}; },
        then:function(res,rej){
          window.__calls.push('from:'+t);
          var out;
          if(sc().overviewError) out={data:null,error:{message:'rls'}};
          else if(t==='coordinator_assignments') out={data:(sc().assignments||[]).map(function(id){return {tasker_user_id:id,assigned_at:'2026-10-01'};}),error:null};
          else if(t==='local_tasker_profiles') out={data:(sc().profiles||[]).filter(function(p){return !q.inList||q.inList.indexOf(p.tasker_user_id)>-1;}),error:null};
          else out={data:[],error:null};
          return Promise.resolve(out).then(res,rej);
        }
      };
      return chain;
    }
  };}};
})();
